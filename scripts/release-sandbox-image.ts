#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalTimers:off globalDate:off - this is a release CLI boundary.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const repositoryRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export interface ReleaseImageCliOptions {
  readonly version: string;
  readonly channel: "stable" | "nightly";
  readonly repository: string;
  readonly buildOutput: string;
  readonly output: string;
  readonly projectId: string;
  readonly teamSlug?: string | undefined;
  readonly token: string;
  readonly makeLatest: boolean;
  readonly timeoutMs: number;
  readonly pollMs: number;
}

export interface ReleaseImageCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export type ReleaseImageCommandRunner = (
  command: string,
  args: ReadonlyArray<string>,
) => Promise<ReleaseImageCommandResult>;

export interface ReleaseImageFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}

export type ReleaseImageFetch = (
  input: string,
  init?: { readonly headers?: Readonly<Record<string, string>> },
) => Promise<ReleaseImageFetchResponse>;

export interface VcrReadinessImage {
  readonly manifestDigest: string;
  readonly platform?: string | undefined;
  readonly arch?: string | undefined;
  readonly status?: "preparing" | "ready" | "unoptimized" | null | undefined;
}

export interface ReleaseBuildFacts {
  readonly version: 1;
  readonly mode: "registry";
  readonly reference?: string | undefined;
  readonly platforms: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  readonly indexDigest: string;
  readonly baseImage: string;
  readonly baseDigest: string;
  readonly kataPackage: string;
  readonly kataVersion: string;
  readonly kataArtifactSha256: string;
  readonly serverArtifactSha256?: string | undefined;
  readonly codexPackage: string;
  readonly codexVersion: string;
  readonly codexArtifactSha256: string;
  readonly codexIntegrity: string;
}

export interface SandboxImageReleaseArtifact {
  readonly version: 1;
  readonly reference: string;
  readonly immutableReference: string;
  readonly indexDigest: string;
  readonly platformDigests: Readonly<Record<string, string>>;
  readonly baseDigest: string;
  readonly kataVersion: string;
  readonly kataArtifactSha256: string;
  readonly codexVersion: string;
  readonly codexArtifactSha256: string;
  readonly codexIntegrity: string;
}

function requiredValue(args: ReadonlyArray<string>, index: number, flag: string): string {
  const value = args[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function positiveInteger(value: string, flag: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new Error(`${flag} must be a positive integer.`);
  return result;
}

function digestFromImageReference(reference: string): string | undefined {
  const at = reference.lastIndexOf("@");
  if (at <= 0 || at !== reference.indexOf("@")) return undefined;
  const digest = reference.slice(at + 1);
  return digestPattern.test(digest) ? digest : undefined;
}

export function parseReleaseImageArgs(
  args: ReadonlyArray<string>,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ReleaseImageCliOptions {
  let version: string | undefined;
  let channel: "stable" | "nightly" = "stable";
  let repository: string | undefined;
  let buildOutput: string | undefined;
  let output = "sandbox-image.json";
  let projectId = environment.VERCEL_PROJECT_ID?.trim();
  let teamSlug = environment.VERCEL_TEAM_SLUG?.trim() || undefined;
  let token = environment.VERCEL_TOKEN?.trim();
  let makeLatest = false;
  let timeoutMs = 20 * 60_000;
  let pollMs = 10_000;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    switch (flag) {
      case "--version":
        version = requiredValue(args, index, flag);
        index += 1;
        break;
      case "--channel": {
        const value = requiredValue(args, index, flag);
        if (value !== "stable" && value !== "nightly")
          throw new Error("--channel must be stable or nightly.");
        channel = value;
        index += 1;
        break;
      }
      case "--repository":
        repository = requiredValue(args, index, flag);
        index += 1;
        break;
      case "--build-output":
        buildOutput = requiredValue(args, index, flag);
        index += 1;
        break;
      case "--output":
        output = requiredValue(args, index, flag);
        index += 1;
        break;
      case "--project-id":
        projectId = requiredValue(args, index, flag);
        index += 1;
        break;
      case "--team-slug":
        teamSlug = requiredValue(args, index, flag);
        index += 1;
        break;
      case "--token":
        token = requiredValue(args, index, flag);
        index += 1;
        break;
      case "--make-latest":
        makeLatest = true;
        break;
      case "--timeout-ms":
        timeoutMs = positiveInteger(requiredValue(args, index, flag), flag);
        index += 1;
        break;
      case "--poll-ms":
        pollMs = positiveInteger(requiredValue(args, index, flag), flag);
        index += 1;
        break;
      case undefined:
        break;
      default:
        throw new Error(`Unknown release image argument '${flag}'.`);
    }
  }

  if (!version || !versionPattern.test(version))
    throw new Error("--version must be a valid release version.");
  if (
    !repository ||
    repository.split("/").length !== 4 ||
    !repository.startsWith("vcr.vercel.com/")
  ) {
    throw new Error("--repository must be vcr.vercel.com/<team>/<project>/kata-sandbox.");
  }
  if (!buildOutput) throw new Error("--build-output is required.");
  if (!projectId) throw new Error("VERCEL_PROJECT_ID or --project-id is required.");
  if (!token) throw new Error("VERCEL_TOKEN or --token is required for VCR readiness polling.");
  return {
    version,
    channel,
    repository,
    buildOutput,
    output,
    projectId,
    teamSlug,
    token,
    makeLatest,
    timeoutMs,
    pollMs,
  };
}

export function releaseImageTags(input: {
  readonly repository: string;
  readonly version: string;
  readonly channel: "stable" | "nightly";
  readonly makeLatest?: boolean;
}): ReadonlyArray<string> {
  const tags = [`${input.repository}:${input.version}`];
  if (input.channel === "nightly") tags.push(`${input.repository}:nightly`);
  else if (input.makeLatest === true) tags.push(`${input.repository}:latest`);
  return tags;
}

export function parsePlatformDigests(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object")
    throw new Error("Buildx inspect did not return an OCI index.");
  const manifests = (value as { readonly manifests?: unknown }).manifests;
  if (!Array.isArray(manifests))
    throw new Error("Buildx inspect did not return an OCI manifest list.");
  const platformDigests: Record<string, string> = {};
  for (const entry of manifests) {
    if (entry === null || typeof entry !== "object") continue;
    const platform = (entry as { readonly platform?: unknown }).platform;
    const digest = (entry as { readonly digest?: unknown }).digest;
    if (
      platform !== null &&
      typeof platform === "object" &&
      typeof (platform as { readonly os?: unknown }).os === "string" &&
      typeof (platform as { readonly architecture?: unknown }).architecture === "string" &&
      typeof digest === "string" &&
      digestPattern.test(digest)
    ) {
      const name = `${(platform as { readonly os: string }).os}/${(platform as { readonly architecture: string }).architecture}`;
      if (name === "linux/amd64" || name === "linux/arm64") platformDigests[name] = digest;
    }
  }
  for (const platform of ["linux/amd64", "linux/arm64"]) {
    if (platformDigests[platform] === undefined)
      throw new Error(`OCI index is missing ${platform}.`);
  }
  return platformDigests;
}

export function assertPlatformManifest(value: unknown, platform: string): void {
  if (value === null || typeof value !== "object") {
    throw new Error(`Buildx inspect did not return the ${platform} image manifest.`);
  }
  const manifest = value as Record<string, unknown>;
  const config = manifest.config;
  const configDigest =
    config !== null && typeof config === "object"
      ? (config as Record<string, unknown>).digest
      : undefined;
  if (
    !digestPattern.test(typeof configDigest === "string" ? configDigest : "") ||
    !Array.isArray(manifest.layers)
  ) {
    throw new Error(`Buildx inspect returned an invalid ${platform} image manifest.`);
  }
}

export function vcrReadinessUrl(input: {
  readonly repository: string;
  readonly projectId: string;
  readonly teamSlug?: string | undefined;
}): string {
  const parts = input.repository.split("/");
  const repository = parts.at(-1);
  if (parts.length !== 4 || parts[0] !== "vcr.vercel.com" || !repository) {
    throw new Error("Invalid VCR repository reference.");
  }
  const params = new URLSearchParams({ projectId: input.projectId });
  if (input.teamSlug) params.set("slug", input.teamSlug);
  return `https://api.vercel.com/v1/vcr/repository/${encodeURIComponent(repository)}/images?${params}`;
}

function decodeReadinessImages(value: unknown): ReadonlyArray<VcrReadinessImage> {
  if (value === null || typeof value !== "object") return [];
  const images = (value as { readonly images?: unknown }).images;
  if (!Array.isArray(images)) return [];
  return images.flatMap((image) => {
    if (image === null || typeof image !== "object") return [];
    const item = image as Record<string, unknown>;
    if (typeof item.manifestDigest !== "string") return [];
    const status = item.status;
    return [
      {
        manifestDigest: item.manifestDigest,
        platform: typeof item.platform === "string" ? item.platform : undefined,
        arch: typeof item.arch === "string" ? item.arch : undefined,
        status:
          status === "preparing" ||
          status === "ready" ||
          status === "unoptimized" ||
          status === null
            ? status
            : undefined,
      },
    ];
  });
}

export async function waitForVcrAmd64Ready(input: {
  readonly url: string;
  readonly token: string;
  readonly platformDigest: string;
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly fetch?: ReleaseImageFetch | undefined;
  readonly sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  readonly now?: (() => number) | undefined;
}): Promise<VcrReadinessImage> {
  const fetchImage: ReleaseImageFetch =
    input.fetch ??
    ((url, init) => fetch(url, init as RequestInit) as Promise<ReleaseImageFetchResponse>);
  const sleep =
    input.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = input.now ?? (() => Date.now());
  const deadline = now() + input.timeoutMs;
  let lastStatus = "missing";
  while (now() <= deadline) {
    const response = await fetchImage(input.url, {
      headers: { accept: "application/json", authorization: `Bearer ${input.token}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`VCR readiness request returned HTTP ${response.status}.`);
    }
    if (response.ok) {
      const images = decodeReadinessImages(await response.json());
      const image = images.find(
        (candidate) =>
          candidate.manifestDigest === input.platformDigest &&
          candidate.platform === "linux" &&
          candidate.arch === "amd64",
      );
      if (image?.status === "ready") return image;
      if (image?.status === "unoptimized") {
        throw new Error("VCR marked the linux/amd64 image unoptimized.");
      }
      lastStatus = image?.status ?? "missing";
    }
    if (now() + input.pollMs > deadline) break;
    await sleep(input.pollMs);
  }
  throw new Error(`Timed out waiting for VCR linux/amd64 readiness (last status: ${lastStatus}).`);
}

export function buildBootstrapManifest(input: {
  readonly imageDigest: string;
  readonly kataVersion: string;
  readonly kataArtifactSha256: string;
  readonly codexVersion: string;
  readonly codexArtifactSha256: string;
}) {
  return {
    version: 1 as const,
    imageDigest: input.imageDigest,
    kataVersion: input.kataVersion,
    serverVersion: input.kataVersion,
    serverArtifactSha256: input.kataArtifactSha256,
    codexVersion: input.codexVersion,
    codexArtifactSha256: input.codexArtifactSha256,
  };
}

export function makeSandboxImageArtifact(input: {
  readonly repository: string;
  readonly indexDigest: string;
  readonly platformDigests: Readonly<Record<string, string>>;
  readonly baseDigest: string;
  readonly kataVersion: string;
  readonly kataArtifactSha256: string;
  readonly codexVersion: string;
  readonly codexArtifactSha256: string;
  readonly codexIntegrity: string;
}): SandboxImageReleaseArtifact {
  if (!digestPattern.test(input.indexDigest) || !digestPattern.test(input.baseDigest)) {
    throw new Error("Sandbox release metadata requires immutable sha256 digests.");
  }
  for (const platform of ["linux/amd64", "linux/arm64"]) {
    if (!digestPattern.test(input.platformDigests[platform] ?? "")) {
      throw new Error(`Sandbox release metadata is missing ${platform}.`);
    }
  }
  if (!/^[0-9a-f]{64}$/i.test(input.kataArtifactSha256)) {
    throw new Error("Kata artifact digest is not sha256 hex.");
  }
  if (!/^[0-9a-f]{64}$/i.test(input.codexArtifactSha256)) {
    throw new Error("Codex artifact digest is not sha256 hex.");
  }
  if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(input.codexIntegrity)) {
    throw new Error("Codex integrity is not npm sha512 integrity.");
  }
  const amd64Digest = input.platformDigests["linux/amd64"];
  const arm64Digest = input.platformDigests["linux/arm64"];
  if (amd64Digest === undefined || arm64Digest === undefined) {
    throw new Error("Sandbox release metadata is missing a required platform digest.");
  }
  return {
    version: 1,
    reference: input.repository,
    immutableReference: `${input.repository}@${input.indexDigest}`,
    indexDigest: input.indexDigest,
    platformDigests: {
      "linux/amd64": amd64Digest,
      "linux/arm64": arm64Digest,
    },
    baseDigest: input.baseDigest,
    kataVersion: input.kataVersion,
    kataArtifactSha256: input.kataArtifactSha256,
    codexVersion: input.codexVersion,
    codexArtifactSha256: input.codexArtifactSha256,
    codexIntegrity: input.codexIntegrity,
  };
}

export function decodeReleaseBuildFacts(value: unknown): ReleaseBuildFacts {
  if (value === null || typeof value !== "object")
    throw new Error("Image build output is not an object.");
  const facts = value as Record<string, unknown>;
  const kataArtifactSha256 = facts.kataArtifactSha256 ?? facts.serverArtifactSha256;
  const baseDigestFromReference =
    typeof facts.baseImage === "string" ? digestFromImageReference(facts.baseImage) : undefined;
  if (
    facts.version !== 1 ||
    facts.mode !== "registry" ||
    typeof facts.platforms !== "object" ||
    !Array.isArray(facts.platforms) ||
    typeof facts.baseImage !== "string" ||
    typeof facts.baseDigest !== "string" ||
    !digestPattern.test(facts.baseDigest) ||
    baseDigestFromReference !== facts.baseDigest ||
    facts.kataPackage !== "@kata-sh/code-cli" ||
    typeof facts.kataVersion !== "string" ||
    typeof kataArtifactSha256 !== "string" ||
    facts.codexPackage !== "@openai/codex" ||
    typeof facts.codexVersion !== "string" ||
    typeof facts.codexArtifactSha256 !== "string" ||
    typeof facts.codexIntegrity !== "string" ||
    typeof facts.indexDigest !== "string" ||
    !digestPattern.test(facts.indexDigest)
  ) {
    throw new Error("Image build output is missing verified release provenance.");
  }
  return {
    version: 1,
    mode: "registry",
    reference: typeof facts.reference === "string" ? facts.reference : undefined,
    platforms: facts.platforms as ReadonlyArray<string>,
    tags: Array.isArray(facts.tags) ? (facts.tags as ReadonlyArray<string>) : [],
    indexDigest: facts.indexDigest,
    baseImage: facts.baseImage,
    baseDigest: facts.baseDigest,
    kataPackage: "@kata-sh/code-cli",
    kataVersion: facts.kataVersion,
    kataArtifactSha256,
    serverArtifactSha256:
      typeof facts.serverArtifactSha256 === "string" ? facts.serverArtifactSha256 : undefined,
    codexPackage: "@openai/codex",
    codexVersion: facts.codexVersion,
    codexArtifactSha256: facts.codexArtifactSha256,
    codexIntegrity: facts.codexIntegrity,
  };
}

async function defaultRun(
  command: string,
  args: ReadonlyArray<string>,
): Promise<ReleaseImageCommandResult> {
  try {
    const result = await execFile(command, [...args], {
      cwd: repositoryRoot,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Release image command '${command}' failed: ${message}`);
  }
}

export async function verifyAndWriteSandboxImage(input: {
  readonly options: ReleaseImageCliOptions;
  readonly runCommand?: ReleaseImageCommandRunner;
  readonly fetch?: ReleaseImageFetch | undefined;
  readonly sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  readonly now?: (() => number) | undefined;
}): Promise<SandboxImageReleaseArtifact> {
  const runCommand = input.runCommand ?? defaultRun;
  const facts = decodeReleaseBuildFacts(
    JSON.parse(NodeFS.readFileSync(input.options.buildOutput, "utf8")),
  );
  if (facts.kataVersion !== input.options.version || facts.codexVersion.length === 0) {
    throw new Error("Image artifact versions do not match the release metadata.");
  }
  if (facts.reference !== undefined && facts.reference !== input.options.repository) {
    throw new Error("Image build output repository does not match the release repository.");
  }
  const indexDigest = facts.indexDigest;
  const immutableReference = `${input.options.repository}@${indexDigest}`;
  const inspected = await runCommand("docker", [
    "buildx",
    "imagetools",
    "inspect",
    "--raw",
    immutableReference,
  ]);
  const platformDigests = parsePlatformDigests(JSON.parse(inspected.stdout));
  const amd64Digest = platformDigests["linux/amd64"];
  if (amd64Digest === undefined) throw new Error("OCI index is missing linux/amd64.");

  for (const platform of ["linux/amd64", "linux/arm64"] as const) {
    const platformReference = `${input.options.repository}@${platformDigests[platform]}`;
    const platformInspection = await runCommand("docker", [
      "buildx",
      "imagetools",
      "inspect",
      "--raw",
      platformReference,
    ]);
    assertPlatformManifest(JSON.parse(platformInspection.stdout), platform);
    const manifest = buildBootstrapManifest({
      imageDigest: platformReference,
      kataVersion: facts.kataVersion,
      kataArtifactSha256: facts.kataArtifactSha256,
      codexVersion: facts.codexVersion,
      codexArtifactSha256: facts.codexArtifactSha256,
    });
    await runCommand("docker", [
      "run",
      "--rm",
      "--pull=always",
      "--platform",
      platform,
      "--entrypoint",
      "/usr/local/bin/kata-sandbox-entrypoint",
      "--env",
      `KATACODE_SANDBOX_MANIFEST=${JSON.stringify(manifest)}`,
      "--env",
      `KATACODE_SANDBOX_IMAGE_DIGEST=${platformReference}`,
      "--env",
      "KATACODE_SANDBOX_RUNTIME_CHECK=1",
      platformReference,
      "true",
    ]);
  }

  const tags = releaseImageTags(input.options);
  for (const tag of tags.slice(1)) {
    await runCommand("docker", [
      "buildx",
      "imagetools",
      "create",
      "--tag",
      tag,
      immutableReference,
    ]);
  }

  await waitForVcrAmd64Ready({
    url: vcrReadinessUrl(input.options),
    token: input.options.token,
    platformDigest: amd64Digest,
    timeoutMs: input.options.timeoutMs,
    pollMs: input.options.pollMs,
    fetch: input.fetch,
    sleep: input.sleep,
    now: input.now,
  });

  const artifact = makeSandboxImageArtifact({
    repository: input.options.repository,
    indexDigest,
    platformDigests,
    baseDigest: facts.baseDigest,
    kataVersion: facts.kataVersion,
    kataArtifactSha256: facts.kataArtifactSha256,
    codexVersion: facts.codexVersion,
    codexArtifactSha256: facts.codexArtifactSha256,
    codexIntegrity: facts.codexIntegrity,
  });
  NodeFS.writeFileSync(input.options.output, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

if (import.meta.main) {
  try {
    const options = parseReleaseImageArgs(process.argv.slice(2));
    await verifyAndWriteSandboxImage({ options });
    process.stdout.write(
      `Wrote ${options.output} for ${options.repository}@${JSON.parse(NodeFS.readFileSync(options.output, "utf8")).indexDigest}.\n`,
    );
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  }
}
