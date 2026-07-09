/**
 * Shared sandbox session types for the server orchestration layer.
 *
 * @module sandboxSessionTypes
 */
import type { SandboxHandle, SandboxProvider } from "@kata-sh/code-sandbox/driver";
import type { SandboxProviderInstanceConfig } from "@kata-sh/code-contracts/sandboxProviderInstance";

/** A live sandbox session record held in memory between RPC calls. The
 *  durable store is the source of truth; this in-memory cache is populated by
 *  startSession/reconcile and read by providerLogin (which needs the live
 *  driver + handle for exec). */
export interface LiveSession {
  handle: SandboxHandle;
  readonly driver: SandboxProvider;
  readonly instanceConfig: SandboxProviderInstanceConfig;
  environmentId: string;
  /** Admin access token minted at start (in-memory only, never persisted).
   *  Enables pairing-token re-issue for a running sandbox (recovery R2).
   *  Absent after a server restart — stop/start re-mints it. */
  adminAccessToken?: string;
}
