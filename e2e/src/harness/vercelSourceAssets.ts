import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Maximum checked-out source bytes allowed before a Vercel E2E provisions anything. */
export const VERCEL_E2E_SOURCE_MAX_BYTES = 256 * 1024;

export interface VercelSourceAssetSummary {
  readonly bytes: number;
  readonly files: number;
}

interface GitHubTreeEntry {
  readonly path?: unknown;
  readonly type?: unknown;
  readonly size?: unknown;
}

interface GitHubTreeResponse {
  readonly truncated?: unknown;
  readonly tree?: unknown;
}

type RunGh = (args: ReadonlyArray<string>) => Promise<string>;

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} did not return a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function repositoryEndpoint(repository: string): string {
  const segments = repository.split("/");
  if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) {
    throw new Error(`Invalid Vercel E2E source repository '${repository}'; expected owner/name.`);
  }
  return segments.map(encodeURIComponent).join("/");
}

async function defaultRunGh(args: ReadonlyArray<string>): Promise<string> {
  const { stdout } = await execFileAsync("gh", [...args], {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
  });
  return stdout;
}

/** Sum the branch's checked-out Git blobs. Truncated trees cannot prove the budget. */
export function summarizeVercelGitTree(input: GitHubTreeResponse): VercelSourceAssetSummary {
  if (input.truncated === true) {
    throw new Error(
      "GitHub truncated the recursive source tree; Vercel E2E asset size is unknown.",
    );
  }
  if (!Array.isArray(input.tree)) {
    throw new Error("GitHub source tree response did not include a tree array.");
  }

  let bytes = 0;
  let files = 0;
  for (const candidate of input.tree as ReadonlyArray<GitHubTreeEntry>) {
    if (candidate.type !== "blob") continue;
    const size = candidate.size;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      throw new Error(
        `GitHub source blob '${String(candidate.path)}' did not include a valid size.`,
      );
    }
    bytes += size;
    files += 1;
  }
  return { bytes, files };
}

export function assertVercelSourceAssetBudget(summary: VercelSourceAssetSummary): void {
  if (summary.bytes > VERCEL_E2E_SOURCE_MAX_BYTES) {
    throw new Error(
      `Selected source is ${summary.bytes} bytes across ${summary.files} files, which exceeds the Vercel E2E source limit of ${VERCEL_E2E_SOURCE_MAX_BYTES} bytes. Use a dedicated minimal fixture repository.`,
    );
  }
}

/** Inspect the exact selected branch through GitHub before Vercel can incur source ingress. */
export async function inspectSmallVercelSource(
  source: { readonly repository: string; readonly branch: string | undefined },
  options: { readonly runGh?: RunGh } = {},
): Promise<VercelSourceAssetSummary & { readonly branch: string }> {
  const runGh = options.runGh ?? defaultRunGh;
  const repository = repositoryEndpoint(source.repository);
  let branch = source.branch;
  if (branch === undefined) {
    const metadata = parseJsonObject(
      await runGh(["api", `repos/${repository}`]),
      "GitHub repository metadata",
    );
    if (typeof metadata.default_branch !== "string" || metadata.default_branch.length === 0) {
      throw new Error("GitHub repository metadata did not include a default branch.");
    }
    branch = metadata.default_branch;
  }

  const tree = parseJsonObject(
    await runGh(["api", `repos/${repository}/git/trees/${encodeURIComponent(branch)}?recursive=1`]),
    "GitHub source tree",
  );
  const summary = summarizeVercelGitTree(tree);
  assertVercelSourceAssetBudget(summary);
  return { ...summary, branch };
}
