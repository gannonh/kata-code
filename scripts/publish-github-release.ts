#!/usr/bin/env node
/**
 * publish-github-release.ts — publish a draft GitHub release once the files its
 * updater manifests reference are uploaded.
 *
 * electron-updater follows the newest published release of a channel. A release
 * that is live while its binaries are still uploading makes every client on the
 * channel fail until the upload finishes, and for good if it never does. The
 * release workflow therefore uploads into a draft, which updaters cannot see,
 * and runs this script last. It leaves the draft alone unless the build produced
 * the feed of every supported platform, and every updater manifest and every
 * file a manifest names is an uploaded asset of the size the build produced.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";

import { isDesktopPreviewVersion, resolveDesktopUpdateChannel } from "./build-desktop-artifact.ts";
import { compareNightlyVersions, parseNightlyTag } from "./resolve-previous-release-tag.ts";
import { parseUpdateManifest, type UpdateManifest } from "./lib/update-manifest.ts";

const MakeLatest = Schema.Literals(["true", "false", "legacy"]);
type MakeLatest = typeof MakeLatest.Type;

const GitHubRelease = Schema.Struct({
  draft: Schema.Boolean,
  html_url: Schema.String,
  tag_name: Schema.String,
});

const GitHubListedRelease = Schema.Struct({
  draft: Schema.Boolean,
  tag_name: Schema.String,
});
type GitHubListedRelease = typeof GitHubListedRelease.Type;

const GitHubReleaseAsset = Schema.Struct({
  name: Schema.String,
  state: Schema.String,
  size: Schema.Number,
});
type GitHubReleaseAsset = typeof GitHubReleaseAsset.Type;

export class DraftReleaseIncompleteError extends Schema.TaggedError<DraftReleaseIncompleteError>()(
  "DraftReleaseIncompleteError",
  { releaseId: Schema.Number, problems: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `Release ${this.releaseId} stays a draft:\n${this.problems.map((problem) => `  - ${problem}`).join("\n")}`;
  }
}

export class StaleNightlyDraftError extends Schema.TaggedError<StaleNightlyDraftError>()(
  "StaleNightlyDraftError",
  { releaseId: Schema.Number, tag: Schema.String, newerTag: Schema.String },
) {
  override get message(): string {
    return `Release ${this.releaseId} (${this.tag}) stays a draft: ${this.newerTag} is already published and newer, and publishing this one now would make it the newest nightly. Delete the draft.`;
  }
}

export class ReleaseManifestUnreadableError extends Schema.TaggedError<ReleaseManifestUnreadableError>()(
  "ReleaseManifestUnreadableError",
  { manifest: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `${this.manifest} is not a readable updater manifest: ${this.detail}`;
  }
}

/**
 * One feed per desktop platform in docs/operations/supported-platforms.md.
 * Re-enabling a parked platform adds its feed here.
 */
const REQUIRED_UPDATER_FEEDS = [
  {
    suffix: "-mac",
    platform: "macOS",
    archUpdateFiles: [
      { arch: "Apple Silicon (arm64)", name: "Kata-Code-macOS-Apple-Silicon-arm64.zip" },
      { arch: "Intel (x64)", name: "Kata-Code-macOS-Intel.zip" },
    ],
  },
  { suffix: "-linux", platform: "Linux x64", archUpdateFiles: [] },
  { suffix: "-linux-arm64", platform: "Linux arm64", archUpdateFiles: [] },
] as const;

export function findMissingUpdaterFeedProblems(
  tag: string,
  manifests: ReadonlyArray<{ readonly name: string; readonly manifest: UpdateManifest }>,
): ReadonlyArray<string> {
  const version = tag.replace(/^v/, "");
  if (isDesktopPreviewVersion(version)) return [];
  const channel = resolveDesktopUpdateChannel(version);
  const manifestsByName = new Map(manifests.map(({ name, manifest }) => [name, manifest]));
  return REQUIRED_UPDATER_FEEDS.flatMap(({ suffix, platform, archUpdateFiles }) => {
    const feed = `${channel}${suffix}.yml`;
    const manifest = manifestsByName.get(feed);
    if (manifest === undefined) {
      return [`${feed}, the ${platform} updater feed, was not produced by this build`];
    }
    return archUpdateFiles
      .filter(({ name }) => !manifest.files.some((file) => file.url === name))
      .map(({ arch, name }) => `${feed} does not name ${name}, the ${arch} update zip`);
  });
}

/** The updater feeds electron-updater reads, as opposed to other YAML in the build output. */
export const isUpdaterManifestName = (name: string): boolean =>
  /^(?:latest|nightly).*\.yml$/.test(name);

/**
 * The newest published nightly that is newer than `tag`, by the order the
 * release notes use (version, then date, then run number), or undefined.
 * Publishing an older nightly after a newer one would make it the newest by
 * publish time, and stable builds the commit of that one.
 */
export function newerPublishedNightlyTag(
  tag: string,
  releases: ReadonlyArray<GitHubListedRelease>,
): string | undefined {
  const current = parseNightlyTag(tag);
  if (current === undefined) return undefined;
  return releases
    .flatMap((release) => {
      const parsed = release.draft ? undefined : parseNightlyTag(release.tag_name);
      return parsed !== undefined && compareNightlyVersions(parsed, current) > 0
        ? [{ tag: release.tag_name, parsed }]
        : [];
    })
    .toSorted((left, right) => compareNightlyVersions(right.parsed, left.parsed))[0]?.tag;
}

export interface ReleaseCompletenessInput {
  readonly manifests: ReadonlyArray<{ readonly name: string; readonly manifest: UpdateManifest }>;
  /** Size in bytes of every file the build produced, by release asset name. */
  readonly localSizes: ReadonlyMap<string, number>;
  readonly assets: ReadonlyArray<GitHubReleaseAsset>;
}

/** Every asset problem that makes a draft unsafe to publish. Empty means its assets are complete. */
export function findIncompleteReleaseProblems(
  input: ReleaseCompletenessInput,
): ReadonlyArray<string> {
  const assetsByName = new Map(input.assets.map((asset) => [asset.name, asset] as const));
  const problems = input.assets
    .filter((asset) => asset.state !== "uploaded")
    .map((asset) => `${asset.name} is ${asset.state}, not uploaded`);

  const notProduced = new Set<string>();
  const check = (name: string, needed: string) => {
    const localSize = input.localSizes.get(name);
    if (localSize === undefined) {
      notProduced.add(name);
      problems.push(`${needed} was not produced by this build`);
      return;
    }
    const asset = assetsByName.get(name);
    if (asset === undefined) {
      problems.push(`${needed} is not on the release`);
    } else if (asset.size !== localSize) {
      problems.push(`${name} is ${asset.size} bytes on the release, ${localSize} built`);
    }
  };

  for (const { name, manifest } of input.manifests) {
    check(name, name);
    const references = new Set([
      ...manifest.files.map((file) => file.url),
      ...(manifest.path === undefined ? [] : [manifest.path]),
    ]);
    for (const reference of references) {
      check(reference, `${reference}, which ${name} references,`);
      const blockmap = `${reference}.blockmap`;
      if (input.localSizes.has(blockmap)) {
        check(blockmap, `${blockmap}, the blockmap of ${reference},`);
      }
    }
  }

  // A reused draft can still hold assets from an earlier attempt, such as a
  // manifest this build no longer writes.
  for (const asset of input.assets) {
    if (!input.localSizes.has(asset.name) && !notProduced.has(asset.name)) {
      problems.push(`${asset.name} is on the release but was not produced by this build`);
    }
  }
  return problems;
}

export interface PublishGitHubReleaseOptions {
  readonly repository: string;
  readonly releaseId: number;
  readonly distDir: string;
  readonly makeLatest: MakeLatest;
}

const readDistFiles = Effect.fn("readDistFiles")(function* (distDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const localSizes = new Map<string, number>();
  const manifests: Array<{ name: string; manifest: UpdateManifest }> = [];
  for (const name of yield* fs.readDirectory(distDir)) {
    const filePath = path.join(distDir, name);
    const stat = yield* fs.stat(filePath);
    if (stat.type !== "File") continue;
    localSizes.set(name, Number(stat.size));
    if (isUpdaterManifestName(name)) {
      const text = yield* fs.readFileString(filePath);
      manifests.push({
        name,
        manifest: yield* Effect.try({
          try: () => parseUpdateManifest(text, name, "release"),
          catch: (cause) =>
            new ReleaseManifestUnreadableError({
              manifest: name,
              detail: cause instanceof Error ? cause.message : String(cause),
            }),
        }),
      });
    }
  }
  return { localSizes, manifests };
});

export const publishGitHubRelease = Effect.fn("publishGitHubRelease")(function* (
  options: PublishGitHubReleaseOptions,
) {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(HttpClientRequest.acceptJson),
    HttpClient.filterStatusOk,
  );
  const getAll = <A, I>(path: string, schema: Schema.Codec<A, I>) =>
    Effect.gen(function* () {
      const all: Array<A> = [];
      for (let page = 1; ; page += 1) {
        const batch = yield* client.get(`${path}?per_page=100&page=${page}`).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(schema))),
        );
        all.push(...batch);
        if (batch.length < 100) return all;
      }
    });
  const releasePath = `/repos/${options.repository}/releases/${options.releaseId}`;

  const release = yield* client.get(releasePath).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(GitHubRelease)),
  );
  if (!release.draft) {
    yield* Effect.log(`Release ${options.releaseId} is already published: ${release.html_url}`);
    return;
  }

  if (parseNightlyTag(release.tag_name) !== undefined) {
    const newerTag = newerPublishedNightlyTag(
      release.tag_name,
      yield* getAll(`/repos/${options.repository}/releases`, GitHubListedRelease),
    );
    if (newerTag !== undefined) {
      return yield* new StaleNightlyDraftError({
        releaseId: options.releaseId,
        tag: release.tag_name,
        newerTag,
      });
    }
  }

  const assets = yield* getAll(`${releasePath}/assets`, GitHubReleaseAsset);
  const { localSizes, manifests } = yield* readDistFiles(options.distDir);
  const problems = [
    ...findMissingUpdaterFeedProblems(release.tag_name, manifests),
    ...findIncompleteReleaseProblems({ manifests, localSizes, assets }),
  ];
  if (problems.length > 0) {
    return yield* new DraftReleaseIncompleteError({ releaseId: options.releaseId, problems });
  }

  const published = yield* client
    .execute(
      HttpClientRequest.patch(releasePath).pipe(
        HttpClientRequest.bodyJsonUnsafe({ draft: false, make_latest: options.makeLatest }),
      ),
    )
    .pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(GitHubRelease)),
    );
  yield* Effect.log(
    `Published release ${options.releaseId} after verifying ${manifests.length} updater manifests: ${published.html_url}`,
  );
});

const command = Command.make(
  "publish-github-release",
  {
    repository: Flag.String("repository").pipe(Flag.withDescription("owner/repo")),
    releaseId: Flag.Finite("release-id").pipe(Flag.withDescription("Draft release id.")),
    distDir: Flag.String("dist").pipe(
      Flag.withDescription("Directory holding the files that were uploaded to the release."),
    ),
    makeLatest: Flag.Literals("make-latest", MakeLatest.literals).pipe(
      Flag.withDescription("Whether the published release becomes the repository's latest."),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const token = yield* Config.String("GITHUB_TOKEN");
      const apiUrl = yield* Config.String("GITHUB_API_URL").pipe(
        Config.withDefault("https://api.github.com"),
      );
      yield* publishGitHubRelease(options).pipe(
        Effect.provideServiceEffect(
          HttpClient.HttpClient,
          Effect.map(HttpClient.HttpClient, (client) =>
            client.pipe(
              HttpClient.mapRequest((request) =>
                request.pipe(
                  HttpClientRequest.prependUrl(apiUrl),
                  HttpClientRequest.bearerToken(token),
                ),
              ),
            ),
          ),
        ),
        Effect.provide(FetchHttpClient.layer),
      );
    }),
).pipe(
  Command.withDescription(
    "Publish a draft GitHub release after checking its updater manifests against its assets.",
  ),
);

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
