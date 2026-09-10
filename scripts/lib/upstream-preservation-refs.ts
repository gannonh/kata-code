// @effect-diagnostics nodeBuiltinImport:off

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { CommitSha, ResolvedRefs } from "./upstream-preservation.ts";

export interface ChangedPath {
  readonly status: string;
  readonly oldPath: string;
  readonly newPath: string;
}

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

export const makeCommitSha = (value: string): CommitSha => {
  if (!COMMIT_SHA_PATTERN.test(value)) {
    throw new Error(`Expected a full lowercase commit SHA, received ${JSON.stringify(value)}.`);
  }
  return value as CommitSha;
};

export const runGit = (repositoryRoot: string, args: ReadonlyArray<string>): string => {
  const result = NodeChildProcess.spawnSync("git", [...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(stderr || `git ${args.join(" ")} exited with status ${String(result.status)}.`);
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
};

export function resolveCommitRef(repositoryRoot: string, reference: string): CommitSha {
  const value = runGit(repositoryRoot, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${reference}^{commit}`,
  ]).toLowerCase();
  return makeCommitSha(value);
}

export function resolveRefs(
  repositoryRoot: string,
  refs: Readonly<{ candidate: string; base: string; upstream: string; upstreamBase: string }>,
): ResolvedRefs {
  return {
    candidate: resolveCommitRef(repositoryRoot, refs.candidate),
    base: resolveCommitRef(repositoryRoot, refs.base),
    upstream: resolveCommitRef(repositoryRoot, refs.upstream),
    upstreamBase: resolveCommitRef(repositoryRoot, refs.upstreamBase),
  };
}

export function validateFrozenUpstreamRefs(repositoryRoot: string, refs: ResolvedRefs): void {
  const forkPath = NodePath.resolve(repositoryRoot, "FORK.md");
  if (!NodeFS.existsSync(forkPath))
    throw new Error("Missing FORK.md; cannot validate upstream pins.");
  const fork = NodeFS.readFileSync(forkPath, "utf8");
  const currentPin = /^\| Current T3 pin[^|]*\| `([0-9a-f]{40})`/m.exec(fork)?.[1];
  const rootPin = /^\| T3 pin \(new `main` root\)[^|]*\| `([0-9a-f]{40})`/m.exec(fork)?.[1];
  if (currentPin === undefined || rootPin === undefined) {
    throw new Error("FORK.md does not declare both frozen upstream refs.");
  }
  if (refs.upstream !== makeCommitSha(currentPin) || refs.upstreamBase !== makeCommitSha(rootPin)) {
    throw new Error(
      `Upstream refs must match FORK.md: upstream=${currentPin}, upstream-base=${rootPin}.`,
    );
  }
}

export const matchesOwnerPath = (changedPath: string, ownerPath: string): boolean =>
  changedPath === ownerPath || changedPath.startsWith(`${ownerPath.replace(/\/$/, "")}/`);

export function parseNameStatusDiff(output: string): ReadonlyArray<ChangedPath> {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [status = "", firstPath = "", secondPath = ""] = line.split("\t");
      if (status.startsWith("R") || status.startsWith("C")) {
        return { status, oldPath: firstPath, newPath: secondPath };
      }
      return { status, oldPath: firstPath, newPath: firstPath };
    });
}
