import { ORCHESTRATION_WS_METHODS, ProjectId } from "@kata-sh/code-contracts";
import { normalizeProjectPathForComparison } from "@kata-sh/code-shared/path";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { subscribe } from "../rpc/client.ts";
import { createProject } from "./commands.ts";

export class WorkspaceProjectError extends Data.TaggedError("WorkspaceProjectError")<{
  readonly message: string;
}> {}

const readProjects = subscribe(ORCHESTRATION_WS_METHODS.subscribeShell, {}).pipe(
  Stream.filter((item) => item.kind === "snapshot"),
  Stream.map((item) => item.snapshot.projects),
  Stream.runHead,
  Effect.flatMap(
    Option.match({
      onNone: () =>
        Effect.fail(
          new WorkspaceProjectError({
            message: "The environment closed before its projects were available.",
          }),
        ),
      onSome: Effect.succeed,
    }),
  ),
);

export const ensureWorkspaceProject = Effect.fn("EnvironmentCommands.ensureWorkspaceProject")(
  function* (input: { readonly workspaceRoot: string; readonly title: string }) {
    const find = (projects: Effect.Success<typeof readProjects>) =>
      projects.find(
        (project) =>
          normalizeProjectPathForComparison(project.workspaceRoot) ===
          normalizeProjectPathForComparison(input.workspaceRoot),
      );
    const existing = find(yield* readProjects);
    if (existing !== undefined) return existing.id;
    const crypto = yield* Crypto.Crypto;
    const projectId = ProjectId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
    const created = yield* createProject({
      ...input,
      projectId,
      createWorkspaceRootIfMissing: false,
    }).pipe(Effect.result);
    const winner = find(yield* readProjects);
    if (winner !== undefined) return winner.id;
    if (created._tag === "Failure") return yield* Effect.fail(created.failure);
    return yield* Effect.fail(
      new WorkspaceProjectError({
        message:
          "The workspace project is not visible after creation. Open the sandbox to try again.",
      }),
    );
  },
);
