import { RoutineError, type RoutineRun, type VcsRef } from "@kata-sh/code-contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { RoutineStore, type RoutineClaim } from "./RoutineStore.ts";

export interface RoutineDispatcherShape {
  readonly drain: (owner: string) => Effect.Effect<void, RoutineError>;
  readonly dispatchClaim: (claim: RoutineClaim) => Effect.Effect<void, RoutineError>;
}

export class RoutineDispatcher extends Context.Service<RoutineDispatcher, RoutineDispatcherShape>()(
  "@kata-sh/code-cli/routines/RoutineDispatcher",
) {}

/** The saved instruction stays first; provider event context follows as untrusted input. */
const routinePromptText = (run: RoutineRun): string =>
  run.eventContext
    ? `${run.configuration.instruction}\n\n${run.eventContext}`
    : run.configuration.instruction;

/** The routine branch name stays stable across retries of the same run. */
export const routineBranchName = (run: Pick<RoutineRun, "id">) => `routine/${run.id}`;

const detailFromCause = (cause: Cause.Cause<unknown>) => Cause.pretty(cause).slice(0, 4_000);

export const failUnlessInterrupted = (
  cause: Cause.Cause<unknown>,
): Effect.Effect<never, RoutineError> =>
  Cause.hasInterruptsOnly(cause)
    ? Effect.failCause(cause as Cause.Cause<never>)
    : Effect.fail(
        new RoutineError({
          code: "blocked",
          message: detailFromCause(cause),
        }),
      );

const remoteRefBranchName = (ref: Pick<VcsRef, "name" | "remoteName" | "isRemote">) =>
  ref.isRemote && ref.remoteName && ref.name.startsWith(`${ref.remoteName}/`)
    ? ref.name.slice(ref.remoteName.length + 1)
    : ref.name;

const resolveConfiguredWorktreeBase = (
  refs: ReadonlyArray<Pick<VcsRef, "name" | "remoteName" | "isRemote" | "isDefault" | "current">>,
  configured: string,
) => {
  if (refs.some((ref) => remoteRefBranchName(ref) === configured)) return configured;
  const defaultRef = refs.find((ref) => ref.isDefault);
  const current =
    refs.find((ref) => ref.current && !ref.isRemote) ?? refs.find((ref) => ref.current);
  const chosen = defaultRef ?? current;
  return chosen ? remoteRefBranchName(chosen) : null;
};

const launchFailureMessage = (error: ThreadLaunch.ThreadLaunchError) => {
  const cause = error.cause;
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `Could not start the routine conversation during ${error.operation.replaceAll("-", " ")}: ${detail}`.slice(
    0,
    4_000,
  );
};

const makeRoutineDispatcher = Effect.gen(function* () {
  const store = yield* RoutineStore;
  const launcher = yield* ThreadLaunch.ThreadLaunchService;
  const projects = yield* ProjectService.ProjectService;
  const git = yield* GitWorkflowService.GitWorkflowService;

  const nowMillis = Effect.map(DateTime.now, DateTime.toEpochMillis);
  const renew = (claim: RoutineClaim) =>
    nowMillis.pipe(Effect.flatMap((now) => store.renew(claim, now)));

  // Every lease decision reads the same Clock, so renewals and the final
  // failure write agree on whether the claim is still held.
  const failBeforeSubmission = (claim: RoutineClaim, cause: Cause.Cause<unknown>) =>
    nowMillis
      .pipe(
        Effect.flatMap((now) =>
          store.updatePreparation(
            claim,
            { stage: "terminal", status: "blocked", detail: detailFromCause(cause) },
            now,
          ),
        ),
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

  const workspaceStrategy = (
    run: RoutineRun,
    workspaceRoot: string,
  ): Effect.Effect<ThreadLaunch.ThreadLaunchWorkspaceStrategy, RoutineError> => {
    const workspace = run.configuration.workspace;
    if (workspace.kind === "shared") {
      if (workspace.directory !== workspaceRoot) {
        return Effect.fail(
          new RoutineError({
            code: "blocked",
            message: `Saved routine directory '${workspace.directory}' no longer matches project '${workspaceRoot}'.`,
          }),
        );
      }
      return Effect.succeed({ type: "root" });
    }
    return git.listRefs({ cwd: workspaceRoot, refKind: "all", limit: 100 }).pipe(
      Effect.mapError(
        (error) =>
          new RoutineError({
            code: "blocked",
            message: `Could not read the project's branches: ${error.message}`,
          }),
      ),
      Effect.flatMap((available) => {
        const baseRef = resolveConfiguredWorktreeBase(available.refs, workspace.baseBranch);
        return baseRef === null
          ? Effect.fail(
              new RoutineError({
                code: "blocked",
                message: `Git project has no default or current branch to start a worktree from (configured '${workspace.baseBranch}').`,
              }),
            )
          : Effect.succeed<ThreadLaunch.ThreadLaunchWorkspaceStrategy>({
              type: "worktree",
              baseRef,
              branch: routineBranchName(run),
              startFromOrigin: workspace.startFromOrigin,
            });
      }),
    );
  };

  /**
   * Launches the run's conversation through orchestration V2. The thread,
   * command, and message ids are fixed when the run is admitted, so a retried
   * dispatch replays the same command receipts instead of creating a second
   * thread or message. Orchestration prepares the workspace (worktree and
   * setup script) and starts the provider turn; the run observer records the
   * outcome from there.
   */
  const dispatchClaimUnsafe = Effect.fn("RoutineDispatcher.dispatchClaim")(function* (
    claim: RoutineClaim,
  ) {
    const run = claim.run;
    const project = yield* projects.getById(run.configuration.projectId).pipe(
      Effect.mapError(
        (error) =>
          new RoutineError({
            code: "blocked",
            message: `Could not read project '${run.configuration.projectId}': ${error.message}`,
          }),
      ),
    );
    if (Option.isNone(project)) {
      return yield* new RoutineError({
        code: "blocked",
        message: `Project '${run.configuration.projectId}' no longer exists.`,
      });
    }
    yield* renew(claim);
    const strategy = yield* workspaceStrategy(run, project.value.workspaceRoot);
    yield* renew(claim);
    yield* store.beginLaunch(claim, yield* nowMillis);
    yield* launcher
      .launch({
        commandId: run.commandId,
        threadId: run.threadId,
        projectId: run.configuration.projectId,
        title: run.configuration.name,
        modelSelection: run.configuration.modelSelection,
        runtimeMode: run.configuration.runtimeMode,
        interactionMode: "default",
        workspaceStrategy: strategy,
        initialMessage: {
          messageId: run.messageId,
          text: routinePromptText(run),
          attachments: [],
        },
        createdBy: "system",
        creationSource: "server",
      })
      .pipe(
        Effect.mapError(
          (error) => new RoutineError({ code: "blocked", message: launchFailureMessage(error) }),
        ),
      );
    yield* store.markLaunched(claim, yield* nowMillis);
  });

  const dispatchClaim: RoutineDispatcherShape["dispatchClaim"] = (claim) => {
    const keepLease = Effect.gen(function* () {
      let lease: "held" | "handed-off" = "held";
      while (lease === "held") {
        yield* Effect.sleep("5 seconds");
        lease = yield* renew(claim);
      }
      // Orchestration owns a launched run; a lease handoff must not interrupt it.
      return yield* Effect.never;
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause as Cause.Cause<never>)
          : Effect.logWarning("routine preparation lease renewal stopped", {
              routineRunId: claim.run.id,
              cause: Cause.pretty(cause),
            }).pipe(Effect.andThen(failUnlessInterrupted(cause))),
      ),
    );
    return dispatchClaimUnsafe(claim).pipe(
      Effect.raceFirst(keepLease),
      Effect.catchCause(failUnlessInterrupted),
      Effect.asVoid,
    );
  };

  const drain: RoutineDispatcherShape["drain"] = Effect.fn("RoutineDispatcher.drain")(
    function* (owner) {
      yield* Effect.gen(function* () {
        for (let count = 0; count < 8; count += 1) {
          const claim = yield* store.claim(owner, yield* nowMillis);
          if (claim === null) return;
          yield* dispatchClaim(claim).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause as Cause.Cause<never>)
                : failBeforeSubmission(claim, cause),
            ),
          );
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause as Cause.Cause<never>)
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
