// @effect-diagnostics nodeBuiltinImport:off

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { resolveCommitRef, runGit } from "./upstream-preservation-refs.ts";
import type {
  CheckStatus,
  CommandPlan,
  PreservationCommandExecutor,
  ResolvedRefs,
} from "./upstream-preservation.ts";

export function runCommandPlan(repositoryRoot: string, command: CommandPlan): CheckStatus {
  const result = NodeChildProcess.spawnSync(command.executable, [...command.args], {
    cwd: repositoryRoot,
    stdio: "ignore",
    env: process.env,
  });
  if (result.error !== undefined) {
    const errorCode =
      "code" in result.error && typeof result.error.code === "string" ? result.error.code : "";
    return errorCode === "ENOENT" ? "NOT RUN" : "FAIL";
  }
  return result.status === 0 ? "PASS" : "FAIL";
}

export function missingRequiredPaths(
  repositoryRoot: string,
  command: Pick<CommandPlan, "requiredPaths">,
): ReadonlyArray<string> {
  return command.requiredPaths.filter(
    (relativePath) => !NodeFS.existsSync(NodePath.resolve(repositoryRoot, relativePath)),
  );
}

const dirtyPaths = (repositoryRoot: string): ReadonlyArray<string> => {
  const output = runGit(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "-z",
  ]);
  const records = output.split("\0").filter((record) => record.length > 0);
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (path.length > 0) paths.push(path);
    if (/[RC]/.test(status)) {
      const destination = records[index + 1];
      if (destination !== undefined && destination.length > 0) {
        paths.push(destination);
        index += 1;
      }
    }
  }
  return paths;
};

export function validateExecutionTree(repositoryRoot: string, refs: ResolvedRefs): void {
  const head = resolveCommitRef(repositoryRoot, "HEAD");
  if (head !== refs.candidate) {
    throw new Error(
      `Repository HEAD ${head} does not match candidate ${refs.candidate}; the gate cannot label another tree as the candidate.`,
    );
  }
  const changedPaths = dirtyPaths(repositoryRoot);
  if (changedPaths.length > 0) {
    throw new Error(
      `Repository checkout is dirty: ${[...new Set(changedPaths)].sort().join(",")}.`,
    );
  }
}

export type { PreservationCommandExecutor };
