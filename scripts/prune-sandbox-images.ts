#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalDate:off - this is a release CLI boundary.

import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

import { vcrReadinessUrl } from "./release-sandbox-image.ts";

// VCR caps the number of images per repository, and every release adds an
// index plus one manifest per platform. Images with a stable or moving tag stay
// forever; prerelease indexes older than the newest few go, along with their
// manifests.
export const KEEP_PRERELEASE_INDEXES = 10;
// Manifests land before the index that references them, so a push running in
// another release job owns manifests no index points at yet.
export const MANIFEST_GRACE_MS = 2 * 60 * 60_000;

const prereleaseTagPattern = /^\d+\.\d+\.\d+-/;

export interface VcrImage {
  readonly id: string;
  readonly manifestDigest: string;
  readonly kind: "index" | "manifest";
  readonly createdAt: string;
  readonly tags: ReadonlyArray<string>;
}

export type PruneFetch = (
  input: string,
  init: { readonly method?: "DELETE"; readonly headers: Readonly<Record<string, string>> },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}>;

export type PruneCommandRunner = (
  command: string,
  args: ReadonlyArray<string>,
) => Promise<{ readonly stdout: string }>;

function hasOnlyPrereleaseTags(image: VcrImage): boolean {
  return image.tags.every((tag) => prereleaseTagPattern.test(tag));
}

export function selectKeptIndexes(
  images: ReadonlyArray<VcrImage>,
  keepPrereleases: number,
): ReadonlyArray<VcrImage> {
  const indexes = images.filter((image) => image.kind === "index");
  const newestPrereleases = new Set(
    indexes
      .filter(hasOnlyPrereleaseTags)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, keepPrereleases),
  );
  return indexes.filter((index) => !hasOnlyPrereleaseTags(index) || newestPrereleases.has(index));
}

export function planSandboxImagePrune(input: {
  readonly images: ReadonlyArray<VcrImage>;
  readonly keptIndexes: ReadonlyArray<VcrImage>;
  readonly keptManifestDigests: ReadonlySet<string>;
  readonly now: number;
}): ReadonlyArray<VcrImage> {
  const kept = new Set(input.keptIndexes);
  const indexes = input.images.filter((image) => image.kind === "index" && !kept.has(image));
  const manifests = input.images.filter(
    (image) =>
      image.kind === "manifest" &&
      hasOnlyPrereleaseTags(image) &&
      !input.keptManifestDigests.has(image.manifestDigest) &&
      input.now - Date.parse(image.createdAt) >= MANIFEST_GRACE_MS,
  );
  return [...indexes, ...manifests];
}

function decodeImagePage(value: unknown): {
  readonly images: ReadonlyArray<VcrImage>;
  readonly nextCursor: string | undefined;
} {
  const page = value as { readonly images?: unknown; readonly nextCursor?: unknown } | null;
  if (page === null || typeof page !== "object" || !Array.isArray(page.images)) {
    throw new Error("VCR image list response has no images array.");
  }
  const images = page.images.map((entry: unknown) => {
    const image = entry as Record<string, unknown>;
    if (
      typeof image.id !== "string" ||
      typeof image.manifestDigest !== "string" ||
      (image.kind !== "index" && image.kind !== "manifest") ||
      typeof image.createdAt !== "string" ||
      !Array.isArray(image.tags)
    ) {
      throw new Error("VCR returned an image entry this script cannot classify.");
    }
    return {
      id: image.id,
      manifestDigest: image.manifestDigest,
      kind: image.kind,
      createdAt: image.createdAt,
      tags: image.tags.filter((tag): tag is string => typeof tag === "string"),
    } satisfies VcrImage;
  });
  return {
    images,
    nextCursor:
      typeof page.nextCursor === "string" && page.nextCursor.length > 0
        ? page.nextCursor
        : undefined,
  };
}

function manifestDigestsOfIndex(raw: string): ReadonlyArray<string> {
  const manifests = (JSON.parse(raw) as { readonly manifests?: unknown }).manifests;
  if (!Array.isArray(manifests)) throw new Error("Kept VCR index has no manifest list.");
  return manifests.map((entry: { readonly digest?: unknown }) => {
    if (typeof entry.digest !== "string") throw new Error("Kept VCR index lists a bad digest.");
    return entry.digest;
  });
}

export async function pruneSandboxImages(input: {
  readonly repository: string;
  readonly projectId: string;
  readonly teamSlug?: string | undefined;
  readonly token: string;
  readonly keepPrereleases: number;
  readonly fetch: PruneFetch;
  readonly runCommand: PruneCommandRunner;
  readonly now: number;
  readonly log: (line: string) => void;
}): Promise<ReadonlyArray<VcrImage>> {
  const headers = { accept: "application/json", authorization: `Bearer ${input.token}` };
  const listUrl = new URL(vcrReadinessUrl(input));
  listUrl.searchParams.set("limit", "100");

  const images: VcrImage[] = [];
  let cursor: string | undefined;
  do {
    if (cursor !== undefined) listUrl.searchParams.set("cursor", cursor);
    const response = await input.fetch(listUrl.toString(), { headers });
    if (!response.ok) throw new Error(`VCR image list returned HTTP ${response.status}.`);
    const page = decodeImagePage(await response.json());
    images.push(...page.images);
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  const keptIndexes = selectKeptIndexes(images, input.keepPrereleases);
  const keptManifestDigests = new Set<string>();
  for (const index of keptIndexes) {
    const inspected = await input.runCommand("docker", [
      "buildx",
      "imagetools",
      "inspect",
      "--raw",
      `${input.repository}@${index.manifestDigest}`,
    ]);
    for (const digest of manifestDigestsOfIndex(inspected.stdout)) keptManifestDigests.add(digest);
  }

  const doomed = planSandboxImagePrune({
    images,
    keptIndexes,
    keptManifestDigests,
    now: input.now,
  });
  input.log(
    `VCR holds ${images.length} images; keeping ${keptIndexes.length} indexes, deleting ${doomed.length} images.`,
  );
  for (const image of doomed) {
    const url = new URL(vcrReadinessUrl(input));
    url.pathname += `/${encodeURIComponent(image.id)}`;
    const response = await input.fetch(url.toString(), { method: "DELETE", headers });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Deleting VCR image ${image.id} returned HTTP ${response.status}.`);
    }
    input.log(`Deleted ${image.kind} ${image.id} ${image.tags.join(",") || image.manifestDigest}`);
  }
  return doomed;
}

if (import.meta.main) {
  try {
    const { values } = NodeUtil.parseArgs({
      options: {
        repository: { type: "string" },
        "project-id": { type: "string" },
        "team-slug": { type: "string" },
      },
    });
    const token = process.env.VERCEL_TOKEN?.trim();
    if (!values.repository || !values["project-id"] || !token) {
      throw new Error("--repository, --project-id, and VERCEL_TOKEN are required.");
    }
    const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
    await pruneSandboxImages({
      repository: values.repository,
      projectId: values["project-id"],
      teamSlug: values["team-slug"],
      token,
      keepPrereleases: KEEP_PRERELEASE_INDEXES,
      fetch: (url, init) => fetch(url, init),
      runCommand: async (command, args) => ({
        stdout: String((await execFile(command, [...args], { maxBuffer: 8 * 1024 * 1024 })).stdout),
      }),
      now: Date.now(),
      log: (line) => process.stdout.write(`${line}\n`),
    });
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  }
}
