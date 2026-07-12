import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";

export function startEnvironmentLeaseMaintenance<EStartup, RStartup, ERenew, RRenew>(input: {
  readonly startupReconcile: Effect.Effect<void, EStartup, RStartup>;
  readonly renewLeases: Effect.Effect<void, ERenew, RRenew>;
  readonly renewalInterval?: Duration.Input;
}): Effect.Effect<void, never, RStartup | RRenew | Scope.Scope> {
  return Effect.gen(function* () {
    yield* Effect.forkScoped(
      input.startupReconcile.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Failed to reconcile Kata Code Connect desired link on startup", {
            cause,
          }),
        ),
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
