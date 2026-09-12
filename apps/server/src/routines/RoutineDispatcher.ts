import {
  CommandId,
  RoutineError,
  RoutineOwnerGeneration,
  type OrchestrationProjectShell,
  type RoutineRun,
  type RoutineProviderSubmission,
} from "@kata-sh/code-contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ProviderCommandReactor from "../orchestration/Services/ProviderCommandReactor.ts";
import { RoutineStore, type RoutineClaim } from "./RoutineStore.ts";

const isoNow = Effect.map(DateTime.now, DateTime.formatIso);

export interface RoutineDispatcherShape {
  readonly drain: (owner: string) => Effect.Effect<void, RoutineError>;
  readonly dispatchClaim: (claim: RoutineClaim) => Effect.Effect<void, RoutineError>;
}

export class RoutineDispatcher extends Context.Service<RoutineDispatcher, RoutineDispatcherShape>()(
  "@kata-sh/code-cli/routines/RoutineDispatcher",
) {}

const routineCreateCommandId = (run: RoutineRun) =>
  CommandId.make(`routine:${run.id}:thread-create`);

const detailFromCause = (cause: Cause.Cause<unknown>) => Cause.pretty(cause).slice(0, 4_000);

export const failUnlessInterrupted = (cause: Cause.Cause<unknown>) =>
  Cause.hasInterruptsOnly(cause)
    ? Effect.failCause(cause)
    : Effect.fail(
        new RoutineError({
          code: "blocked",
          message: detailFromCause(cause),
        }),
      );

const remoteRefBranchName = (ref: {
  readonly name: string;
  readonly remoteName?: string;
  readonly isRemote: boolean;
}) =>
  ref.isRemote && ref.remoteName && ref.name.startsWith(`${ref.remoteName}/`)
    ? ref.name.slice(ref.remoteName.length + 1)
    : ref.name;

const resolveConfiguredWorktreeBase = (
  refs: ReadonlyArray<{
    readonly name: string;
    readonly remoteName?: string;
    readonly isRemote: boolean;
    readonly isDefault: boolean;
    readonly current: boolean;
  }>,
  configured: string,
) => {
  if (refs.some((ref) => remoteRefBranchName(ref) === configured)) return configured;
  const defaultRef = refs.find((ref) => ref.isDefault);
  const current =
    refs.find((ref) => ref.current && !ref.isRemote) ?? refs.find((ref) => ref.current);
  const chosen = defaultRef ?? current;
  return chosen ? remoteRefBranchName(chosen) : null;
};

const makeRoutineDispatcher = Effect.gen(function* () {
  const store = yield* RoutineStore;
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const projection = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const git = yield* GitWorkflowService.GitWorkflowService;
  const setupScripts = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const providerCommandReactor = yield* ProviderCommandReactor.ProviderCommandReactor;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const renew = (claim: RoutineClaim) =>
    DateTime.now.pipe(
      Effect.map(DateTime.toEpochMillis),
      Effect.flatMap((now) => store.renew(claim, now)),
    );

  const failBeforeSubmission = (claim: RoutineClaim, cause: Cause.Cause<unknown>) =>
    store
      .updatePreparation(
        claim,
        {
          stage: "terminal",
          status: "blocked",
          detail: detailFromCause(cause),
        },
        DateTime.toEpochMillis(DateTime.nowUnsafe()),
      )
      .pipe(
        Effect.ignoreCause({ log: false }),
        Effect.andThen(
          Effect.logWarning("routine run could not be dispatched", {
            routineRunId: claim.run.id,
            cause: Cause.pretty(cause),
          }),
        ),
      );

  const createWorktree = (claim: RoutineClaim, project: OrchestrationProjectShell) => {
    if (claim.run.configuration.workspace.kind !== "worktree") {
      return Effect.succeed<Readonly<{ branch: null; worktreePath: null }>>({
        branch: null,
        worktreePath: null,
      });
    }
    const workspace = claim.run.configuration.workspace;
    return Effect.gen(function* () {
      const branch = `routine/${claim.run.id}`;
      const worktreePath = path.join(
        path.dirname(project.workspaceRoot),
        ".kata-routines",
        String(claim.run.id),
      );
      yield* renew(claim);
      yield* fileSystem.makeDirectory(path.dirname(worktreePath), { recursive: true });
      yield* renew(claim);
      const available = yield* git.listRefs({
        cwd: project.workspaceRoot,
        refKind: "all",
        limit: 100,
      });
      yield* renew(claim);
      const baseBranch = resolveConfiguredWorktreeBase(available.refs, workspace.baseBranch);
      if (baseBranch === null) {
        return yield* new RoutineError({
          code: "blocked",
          message: `Git project has no default or current branch to start a worktree from (configured '${workspace.baseBranch}').`,
        });
      }
      let refName = baseBranch;
      const hasOrigin =
        workspace.startFromOrigin &&
        (yield* git.remoteExists({ cwd: project.workspaceRoot, remoteName: "origin" }));
      yield* renew(claim);
      if (hasOrigin) {
        yield* git.fetchRemote({ cwd: project.workspaceRoot, remoteName: "origin" });
        yield* renew(claim);
        const hasRemoteBranch = yield* git.remoteBranchExists({
          cwd: project.workspaceRoot,
          remoteName: "origin",
          refName: baseBranch,
        });
        yield* renew(claim);
        if (hasRemoteBranch) {
          refName = (yield* git.resolveRemoteTrackingCommit({
            cwd: project.workspaceRoot,
            refName: baseBranch,
            fallbackRemoteName: "origin",
          })).commitSha;
          yield* renew(claim);
        }
      }
      const refs = yield* git.listRefs({
        cwd: project.workspaceRoot,
        query: branch,
        refKind: "all",
        limit: 20,
      });
      yield* renew(claim);
      const existing = refs.refs.find((ref) => !ref.isRemote && ref.name === branch);
      if (existing !== undefined) {
        if (existing.worktreePath !== null && existing.worktreePath !== worktreePath) {
          return yield* new RoutineError({
            code: "blocked",
            message: `Routine branch '${branch}' already belongs to a different worktree.`,
          });
        }
        const worktreeExists =
          existing.worktreePath === worktreePath ? yield* fileSystem.exists(worktreePath) : true;
        yield* renew(claim);
        if (existing.worktreePath === worktreePath && !worktreeExists) {
          yield* renew(claim);
          return yield* new RoutineError({
            code: "blocked",
            message: `Routine worktree '${worktreePath}' is registered but missing on disk.`,
          });
        }
        if (existing.worktreePath === worktreePath) return { branch, worktreePath };
        const attached = yield* git.createWorktree({
          cwd: project.workspaceRoot,
          refName: branch,
          path: worktreePath,
        });
        yield* renew(claim);
        return { branch: attached.worktree.refName, worktreePath: attached.worktree.path };
      }
      const result = yield* git.createWorktree({
        cwd: project.workspaceRoot,
        refName,
        newRefName: branch,
        baseRefName: baseBranch,
        path: worktreePath,
      });
      yield* renew(claim);
      return { branch: result.worktree.refName, worktreePath: result.worktree.path };
    });
  };

  const dispatchClaimUnsafe = Effect.fn("RoutineDispatcher.dispatchClaim")(function* (
    claim: RoutineClaim,
  ) {
    const submission: RoutineProviderSubmission = {
      runId: claim.run.id,
      owner: claim.owner,
      generation: RoutineOwnerGeneration.make(claim.generation),
      threadId: claim.run.threadId,
      messageId: claim.run.messageId,
      commandId: claim.run.commandId,
    };

    // A prior process may have committed the turn-start event and then
    // stopped before its hot event reached ProviderCommandReactor. Replay
    // that durable intent through the same reactor path using this claim's
    // generation. The reactor's provider fence decides whether submission
    // is still available; no adapter is called from the dispatcher.
    if (claim.run.stage === "prompt-accepted") {
      yield* providerCommandReactor.recoverRoutineSubmission({
        run: claim.run,
        submission,
      });
      return;
    }
    const projectOption = yield* projection.getProjectShellById(claim.run.configuration.projectId);
    if (Option.isNone(projectOption)) {
      return yield* new RoutineError({
        code: "blocked",
        message: `Project '${claim.run.configuration.projectId}' no longer exists.`,
      });
    }
    const project = projectOption.value;
    if (
      claim.run.configuration.workspace.kind === "shared" &&
      claim.run.configuration.workspace.directory !== project.workspaceRoot
    ) {
      return yield* new RoutineError({
        code: "blocked",
        message: `Saved routine directory '${claim.run.configuration.workspace.directory}' no longer matches project '${project.workspaceRoot}'.`,
      });
    }
    yield* renew(claim);
    const existingThread = yield* projection.getThreadShellById(claim.run.threadId);
    yield* renew(claim);
    let worktree: { readonly branch: string | null; readonly worktreePath: string | null } = {
      branch: null,
      worktreePath: null,
    };
    const needsWorktree =
      claim.run.configuration.workspace.kind === "worktree" &&
      (Option.isNone(existingThread) || existingThread.value.worktreePath === null);
    if (needsWorktree) {
      worktree = yield* createWorktree(claim, project);
    } else if (Option.isSome(existingThread) && existingThread.value.worktreePath !== null) {
      worktree = {
        branch: existingThread.value.branch,
        worktreePath: existingThread.value.worktreePath,
      };
    }
    if (Option.isNone(existingThread)) {
      yield* renew(claim);
      const createdAt = yield* isoNow;
      yield* engine.dispatch({
        type: "thread.create",
        commandId: routineCreateCommandId(claim.run),
        threadId: claim.run.threadId,
        projectId: claim.run.configuration.projectId,
        title: claim.run.configuration.name,
        modelSelection: claim.run.configuration.modelSelection,
        runtimeMode: claim.run.configuration.runtimeMode,
        interactionMode: "default",
        branch: worktree.branch,
        worktreePath: worktree.worktreePath,
        createdAt,
      });
      yield* store.updatePreparation(
        claim,
        {
          stage: "thread-created",
          status: "starting",
          detail: null,
          conversation: { kind: "confirmed", threadId: claim.run.threadId },
        },
        DateTime.toEpochMillis(DateTime.nowUnsafe()),
      );
    }

    const threadNeedsWorkspaceUpdate =
      Option.isNone(existingThread) || existingThread.value.worktreePath === null;
    const setupPending =
      claim.run.configuration.workspace.kind === "worktree" &&
      worktree.worktreePath !== null &&
      !claim.setupComplete;
    if (worktree.worktreePath !== null && (threadNeedsWorkspaceUpdate || setupPending)) {
      if (threadNeedsWorkspaceUpdate) {
        yield* renew(claim);
        yield* engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.make(`routine:${claim.run.id}:thread-meta`),
          threadId: claim.run.threadId,
          branch: worktree.branch,
          worktreePath: worktree.worktreePath,
        });
      }
      if (setupPending && claim.run.configuration.workspace.runSetupScript) {
        yield* renew(claim);
        yield* setupScripts.runForThread({
          threadId: claim.run.threadId,
          projectId: claim.run.configuration.projectId,
          projectCwd: project.workspaceRoot,
          worktreePath: worktree.worktreePath,
        });
        yield* renew(claim);
      }
      if (setupPending) {
        yield* store.markSetupComplete(claim, DateTime.toEpochMillis(DateTime.nowUnsafe()));
      }
    }

    yield* renew(claim);
    const accepted = yield* engine.dispatch({
      type: "thread.turn.start",
      commandId: claim.run.commandId,
      threadId: claim.run.threadId,
      message: {
        messageId: claim.run.messageId,
        role: "user",
        text: claim.run.configuration.instruction,
        attachments: [],
      },
      modelSelection: claim.run.configuration.modelSelection,
      titleSeed: claim.run.configuration.name,
      runtimeMode: claim.run.configuration.runtimeMode,
      interactionMode: "default",
      routineSubmission: submission,
      createdAt: yield* isoNow,
    });
    yield* store.updatePreparation(
      claim,
      {
        stage: "prompt-accepted",
        status: "starting",
        detail: `Orchestration accepted sequence ${accepted.sequence}.`,
        conversation: { kind: "confirmed", threadId: claim.run.threadId },
      },
      DateTime.toEpochMillis(DateTime.nowUnsafe()),
    );
    // Ensure a receipt committed immediately before a worker crash still
    // reaches the provider reactor. This is idempotent with the hot event;
    // the irreversible provider CAS permits at most one adapter call.
    yield* providerCommandReactor.recoverRoutineSubmission({
      run: claim.run,
      submission,
    });
  });

  const dispatchClaim: RoutineDispatcherShape["dispatchClaim"] = (claim) => {
    const keepLease = Effect.forever(
      Effect.sleep("5 seconds").pipe(Effect.andThen(renew(claim))),
    ).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("routine preparation lease renewal stopped", {
              routineRunId: claim.run.id,
              cause: Cause.pretty(cause),
            }).pipe(Effect.andThen(Effect.failCause(cause))),
      ),
    );
    return dispatchClaimUnsafe(claim).pipe(
      Effect.raceFirst(keepLease),
      Effect.catchCause(failUnlessInterrupted),
    );
  };

  const drain: RoutineDispatcherShape["drain"] = Effect.fn("RoutineDispatcher.drain")(
    function* (owner) {
      yield* Effect.gen(function* () {
        for (let count = 0; count < 8; count += 1) {
          const claim = yield* store.claim(owner, DateTime.toEpochMillis(DateTime.nowUnsafe()));
          if (claim === null) return;
          yield* dispatchClaim(claim).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : failBeforeSubmission(claim, cause),
            ),
          );
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("routine dispatcher drain failed", {
                cause: Cause.pretty(cause),
              }),
        ),
      );
    },
  );

  return { drain, dispatchClaim } satisfies RoutineDispatcherShape;
});

export const RoutineDispatcherLive = Layer.effect(RoutineDispatcher, makeRoutineDispatcher);
