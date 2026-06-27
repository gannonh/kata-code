/**
 * Sandbox session lifecycle state. Used by later phases (composer status,
 * disposal); defined now so the contract is stable. `unknown` covers
 * forward-compat for states a future driver may introduce.
 *
 * @module sessionState
 */
import * as Schema from "effect/Schema";

export const SandboxSessionState = Schema.Literals([
  "provisioning",
  "ready",
  "error",
  "disposed",
  "unknown",
]);
export type SandboxSessionState = typeof SandboxSessionState.Type;
