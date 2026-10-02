#!/usr/bin/env node
/**
 * publish-github-release.ts — publish a draft GitHub release once the files its
 * updater manifests reference are uploaded.
 *
 * electron-updater follows the newest published release of a channel. A release
 * that is live while its binaries are still uploading makes every client on the
 * channel fail until the upload finishes, and for good if it never does. The
 * release workflow therefore uploads into a draft, which updaters cannot see,
 * and runs this script last. It leaves the draft alone unless every updater
 * manifest and every file a manifest names is an uploaded asset of the size the
 * build produced.
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

const MakeLatest = Schema.Literals(["true", "false", "legacy"]);
type MakeLatest = typeof MakeLatest.Type;

const GitHubRelease = Schema.Struct({
  draft: Schema.Boolean,
  html_url: Schema.String,
});

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

/** The file names an electron-builder manifest tells updaters to download. */
export function manifestReferences(manifest: string): ReadonlyArray<string> {
  const names = new Set<string>();
  for (const line of manifest.split(/\r?\n/)) {
    const match = /^(?:\s+-\s+url|path):\s*(.+?)\s*$/.exec(line);
    if (match?.[1]) {
      names.add(match[1].replace(/^(['"])(.*)\1$/, "$2"));
    }
  }
  return [...names];
}

export interface ReleaseCompletenessInput {
  readonly manifests: ReadonlyArray<{ readonly name: string; readonly text: string }>;
  /** Size in bytes of every file the build produced, by release asset name. */
  readonly localSizes: ReadonlyMap<string, number>;
  readonly assets: ReadonlyArray<GitHubReleaseAsset>;
}

/** Everything that makes a draft unsafe to publish. Empty means it is complete. */
export function findIncompleteReleaseProblems(
  input: ReleaseCompletenessInput,
): ReadonlyArray<string> {
  const assetsByName = new Map(input.assets.map((asset) => [asset.name, asset] as const));
  const problems = input.assets
    .filter((asset) => asset.state !== "uploaded")
    .map((asset) => `${asset.name} is ${asset.state}, not uploaded`);

  const check = (name: string, needed: string) => {
    const localSize = input.localSizes.get(name);
    if (localSize === undefined) {
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

  for (const manifest of input.manifests) {
    check(manifest.name, `${manifest.name}`);
    for (const reference of manifestReferences(manifest.text)) {
      check(reference, `${reference}, which ${manifest.name} references,`);
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
  const manifests: Array<{ name: string; text: string }> = [];
  for (const name of yield* fs.readDirectory(distDir)) {
    const filePath = path.join(distDir, name);
    const stat = yield* fs.stat(filePath);
    if (stat.type !== "File") continue;
    localSizes.set(name, Number(stat.size));
    if (name.endsWith(".yml")) {
      manifests.push({ name, text: yield* fs.readFileString(filePath) });
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
  const releasePath = `/repos/${options.repository}/releases/${options.releaseId}`;

  const release = yield* client.get(releasePath).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(GitHubRelease)),
  );
  if (!release.draft) {
    yield* Effect.log(`Release ${options.releaseId} is already published: ${release.html_url}`);
    return;
  }

  const assets: Array<GitHubReleaseAsset> = [];
  for (let page = 1; ; page += 1) {
    const batch = yield* client.get(`${releasePath}/assets?per_page=100&page=${page}`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(GitHubReleaseAsset))),
    );
    assets.push(...batch);
    if (batch.length < 100) break;
  }

  const { localSizes, manifests } = yield* readDistFiles(options.distDir);
  const problems = findIncompleteReleaseProblems({ manifests, localSizes, assets });
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
