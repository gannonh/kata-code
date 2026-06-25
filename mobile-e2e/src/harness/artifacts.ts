import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mobileE2eRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = join(mobileE2eRoot, "..");

export function resolveMobileE2eRoot(): string {
  return mobileE2eRoot;
}

export function resolveRepoRoot(): string {
  return repoRoot;
}

/** Run manifests and machine-readable reports (gitignored). */
export function resolveArtifactRoot(): string {
  return join(mobileE2eRoot, "test-results");
}

/** Maestro output directory: screenshots, hierarchy, video (gitignored). */
export function resolveMaestroOutputRoot(): string {
  return join(mobileE2eRoot, "artifacts");
}

export function resolveAuthStatePath(): string {
  return join(mobileE2eRoot, ".auth", "connect.json");
}

export function resolveRunManifestPath(runId: string): string {
  return join(resolveArtifactRoot(), runId, "manifest.json");
}

export interface RunManifest {
  readonly runId: string;
  readonly tags: readonly string[];
  readonly katacodeHome: string;
  readonly serverPort: number;
  readonly serverHost: string;
  readonly simulatorUdid: string | null;
  readonly appBundleId: string;
  readonly artifactRoot: string;
  readonly projectPath: string | null;
  readonly createdAt: string;
}

export async function writeRunManifest(manifest: RunManifest): Promise<string> {
  const manifestPath = resolveRunManifestPath(manifest.runId);
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

export async function appendProcessLog(
  artifactRoot: string,
  label: string,
  chunk: string,
): Promise<void> {
  const logPath = join(artifactRoot, `${label}.log`);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, chunk, { flag: "a" });
}
