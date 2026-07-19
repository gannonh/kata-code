import type { ServerProvider } from "@kata-sh/code-contracts";
import type * as Effect from "effect/Effect";
import type * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import type { ProviderMaintenanceCapabilities } from "../providerMaintenance.ts";

export interface ServerProviderShape {
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly getSnapshot: Effect.Effect<ServerProvider>;
  readonly refresh: Effect.Effect<ServerProvider>;
  readonly streamChanges: Stream.Stream<ServerProvider>;
  /**
   * Acquire a change subscription synchronously in the caller's fiber.
   * Use this (then `Stream.fromSubscription`) when forking a consumer so a
   * publish cannot land before the subscription is registered.
   * `streamChanges` alone is unsafe for that pattern because
   * `Stream.fromPubSub` defers subscribe until the stream starts.
   */
  readonly subscribeChanges: Effect.Effect<PubSub.Subscription<ServerProvider>, never, Scope.Scope>;
}
