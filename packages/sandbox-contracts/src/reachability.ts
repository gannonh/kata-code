/**
 * How a client reaches a sandbox's Kata server port, per the driver's declared
 * reachability kind. Maps onto the existing `AdvertisedEndpointReachability`
 * (`loopback | lan | private-network | public`) — not a new axis.
 *
 * V1 sandbox kinds use `loopback` (local container) and `public` (cloud tunnel).
 * `private-network` is reserved for future ssh/tailnet drivers; `lan` is
 * intentionally unused by any V1 sandbox kind (the forward mapping is total; the
 * reverse is not — a later test asserts this).
 *
 * @module reachability
 */
import * as Schema from "effect/Schema";

export const SandboxReachabilityKind = Schema.Literals(["loopback", "public", "private-network"]);
export type SandboxReachabilityKind = typeof SandboxReachabilityKind.Type;
