import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";

/** Renews an existing live link before considering a full reconciliation.
 * Reconciliation rotates the environment credential, so running it on every
 * startup can invalidate agent-activity requests already using that credential. */
export function reconcileEnvironmentLeaseOnStartup<ERenew, RRenew, EReconcile, RReconcile>(input: {
  readonly renewLease: Effect.Effect<boolean, ERenew, RRenew>;
  readonly reconcileLink: Effect.Effect<void, EReconcile, RReconcile>;
}): Effect.Effect<"renewed" | "reconciled", ERenew | EReconcile, RRenew | RReconcile> {
  return input.renewLease.pipe(
    Effect.flatMap((isRenewed) =>
      isRenewed
        ? Effect.succeed("renewed" as const)
        : input.reconcileLink.pipe(Effect.as("reconciled" as const)),
    ),
  );
}

export function startEnvironmentLeaseMaintenance<EStartup, RStartup, ERenew, RRenew>(input: {
  readonly startupReconcile: Effect.Effect<void, EStartup, RStartup>;
  readonly renewLeases: Effect.Effect<void, ERenew, RRenew>;
  readonly renewalInterval?: Duration.Input;
  /** Always runs after startup reconcile settles (success or failure). */
  readonly onStartupSettled?: Effect.Effect<void>;
}): Effect.Effect<void, never, RStartup | RRenew | Scope.Scope> {
  return Effect.gen(function* () {
    const onStartupSettled = input.onStartupSettled ?? Effect.void;
    yield* Effect.forkScoped(
      input.startupReconcile.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Failed to reconcile Kata Code Connect desired link on startup", {
            cause,
          }),
        ),
        Effect.ensuring(onStartupSettled),
      ),
    );
    yield* Effect.forkScoped(
      input.renewLeases.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Failed to renew Kata Code Connect environment lease", {
            cause,
          }),
        ),
        Effect.repeat(Schedule.spaced(input.renewalInterval ?? "5 minutes")),
      ),
    );
  });
}
