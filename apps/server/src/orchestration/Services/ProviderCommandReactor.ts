/**
 * ProviderCommandReactor - Provider command reaction service interface.
 *
 * Owns background workers that react to orchestration intent events and
 * dispatch provider-side command execution.
 *
 * @module ProviderCommandReactor
 */
import * as Context from "effect/Context";
import type { RoutineProviderSubmission, RoutineRun } from "@kata-sh/code-contracts";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

/**
 * ProviderCommandReactorShape - Service API for provider command reactors.
 */
export interface ProviderCommandReactorShape {
  /**
   * Start reacting to provider-intent orchestration domain events.
   *
   * The returned effect must be run in a scope so all worker fibers can be
   * finalized on shutdown.
   * It subscribes before returning. Event handling waits for server activation.
   *
   * Filters orchestration domain events to provider-intent types before
   * processing.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal processing queue is empty and idle.
   * Intended for test use to replace timing-sensitive sleeps.
   */
  readonly drain: Effect.Effect<void>;

  /** Replays a durable routine turn-start with the caller's current fence. */
  readonly recoverRoutineSubmission: (input: {
    readonly run: RoutineRun;
    readonly submission: RoutineProviderSubmission;
  }) => Effect.Effect<void>;
}

/**
 * ProviderCommandReactor - Service tag for provider command reaction workers.
 */
export class ProviderCommandReactor extends Context.Service<
  ProviderCommandReactor,
  ProviderCommandReactorShape
>()("@kata-sh/code-cli/orchestration/Services/ProviderCommandReactor") {}
