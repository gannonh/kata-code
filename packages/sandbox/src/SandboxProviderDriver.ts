/**
 * `SandboxProviderDriver` — the capability-based driver SPI a sandbox provider
 * implements. **Frozen by the Phase 1 spec**: later phases may add optional
 * capabilities but must not change required signatures without a spec
 * amendment. A type-level conformance test (the stub satisfies `SandboxProvider`)
 * is the drift guard; the actual freeze is the process rule.
 *
 * One SPI spans local-container and cloud: a small set of **required**
 * primitives every driver implements, plus **optional** capabilities a driver
 * may omit. The registry degrades gracefully when a capability is absent
 * (`describe()` advertises what is present; callers guard with capability
 * checks). Mirrors AgentBox's `CloudBackend` shape (local Docker as a
 * first-class sibling of cloud providers behind one interface).
 *
 * @module SandboxProviderDriver
 */
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";

import type { SandboxProviderDriverKind } from "@kata-sh/code-sandbox-contracts/instance";
import type { SandboxReachabilityKind } from "@kata-sh/code-sandbox-contracts/reachability";
import type { SandboxProviderDescriptor } from "./descriptor.ts";

/**
 * Opaque handle to a provisioned sandbox. Driver-defined; carries whatever the
 * driver needs to reach the sandbox later (`containerId` + published port for
 * the container driver, a sandbox id for cloud, …).
 */
export interface SandboxHandle {
  readonly driverKind: SandboxProviderDriverKind;
  readonly instanceId: string;
  /** Driver-defined opaque state (container id, sandbox id, …). */
  readonly handle: unknown;
}

/**
 * Request to provision/boot a sandbox. Driver-interpreted `config` is the
 * decoded `SandboxProviderInstanceConfig.config` payload the driver owns.
 */
export interface SandboxProvisionRequest {
  readonly instanceId: string;
  readonly config: unknown;
  /** Resolved base image (driver default if the config omits one). */
  readonly image: string;
  /** Optional in-container env vars (already materialized with secrets). */
  readonly env?: ReadonlyArray<readonly [string, string]>;
  /**
   * Optional stable namespace for cloud sandbox names that must be unique across
   * Kata server installations sharing one cloud project (e.g. Vercel). Typically
   * the server environment id. Absent ⇒ driver derives the name from
   * `instanceId` alone (fine for local Docker).
   */
  readonly nameNamespace?: string;
}

/** Result of `exec(handle, cmd)`. */
export interface SandboxExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Why a sandbox operation failed. Surfaced explicitly (no silent fallback). */
export type SandboxProviderErrorReason =
  | "provision-failed"
  | "exec-failed"
  | "dispose-failed"
  | "invalid-config"
  | "unreachable"
  | "timeout"
  | "unknown";

/**
 * Tagged Effect error carrying a `reason` + optional `cause`. Failures are
 * explicit (roadmap fail-loud constraint): an unknown driver is "unavailable"
 * at the registry layer (not a throw), but a real provision/validate/exec
 * failure surfaces as this error.
 */
export class SandboxProviderError extends Data.TaggedError("SandboxProviderError")<{
  readonly reason: SandboxProviderErrorReason;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Reachability result — an `AdvertisedEndpoint`-shaped value the client
 * connects through. Phase 1's container driver returns a loopback URL; the
 * cloud driver (Phase 3) returns a tunnel URL. Kept structural here so
 * `packages/sandbox` does not depend on the full `AdvertisedEndpoint` contract;
 * drivers construct a full `AdvertisedEndpoint` via
 * `packages/shared/src/advertisedEndpoint.ts` at the server layer.
 */
export interface SandboxReachability {
  readonly reachabilityKind: SandboxReachabilityKind;
  /** e.g. `http://localhost:32789` (loopback) or `https://<tunnel>.trycloudflare.com` (public). */
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

/** Optional capability: snapshot lifecycle (Phase 5). */
export interface SandboxSnapshotCapability {
  createSnapshot(
    handle: SandboxHandle,
    options?: { readonly name?: string },
  ): Effect.Effect<{ readonly snapshotId: string }, SandboxProviderError>;
  deleteSnapshot(snapshotId: string): Effect.Effect<void, SandboxProviderError>;
  snapshotExists(snapshotId: string): Effect.Effect<boolean, SandboxProviderError>;
}

/** Optional capability: extend a session's lifetime (Phase 3/4). */
export interface SandboxRenewTimeoutCapability {
  renewTimeout(handle: SandboxHandle, extendMs: number): Effect.Effect<void, SandboxProviderError>;
}

/**
 * Optional capability: copy a tar archive into a running sandbox (Phase 2).
 * Used to seed a repo working tree at `/workspace` before `install`/`start`.
 * The driver receives a host-built tar blob and a destination path; a driver
 * lacking this capability cannot be seeded (cloud drivers in Phase 3 seed via
 * git clone or native upload, so the capability is genuinely driver-specific,
 * not portable through `exec`). Absent ⇒ `describe().supportsCopyInto === false`.
 */
export interface SandboxCopyIntoCapability {
  copyInto(
    handle: SandboxHandle,
    archive: Uint8Array,
    destPath: string,
  ): Effect.Effect<void, SandboxProviderError>;
}

/**
 * Optional capability: durable stop/start lifecycle.
 *
 * Both Vercel Sandbox (v2 persistent sandboxes) and Docker (named containers)
 * can stop a sandbox without destroying it and start it again later, with the
 * filesystem preserved. `stop`/`start`/`status` are the durable lifecycle
 * primitives; `start` subsumes the former `resume` capability. Absent ⇒
 * `describe().supportsLifecycle === false`; the server layer fails loud rather
 * than silently recreating.
 *
 * Contract semantics:
 * - `stop` on an already-stopped sandbox is idempotent success.
 * - `start` on a running sandbox is idempotent success (re-verifies serve +
 *   healthz) and returns a refreshed handle.
 * - `start` on a `gone` sandbox fails `provision-failed` with a message telling
 *   the user to create a new sandbox.
 * - `status` never mutates.
 */
export type SandboxLifecycleStatus = "running" | "stopped" | "gone";

export interface SandboxLifecycleCapability {
  stop(handle: SandboxHandle): Effect.Effect<void, SandboxProviderError>;
  start(
    handle: SandboxHandle,
    req: { readonly config: unknown; readonly env?: ReadonlyArray<readonly [string, string]> },
  ): Effect.Effect<SandboxHandle, SandboxProviderError>;
  status(handle: SandboxHandle): Effect.Effect<SandboxLifecycleStatus, SandboxProviderError>;
  /** Discover an existing sandbox for an instance that has no store record
   *  (e.g. created before the durable store existed, or after a store reset).
   *  Returns a handle + status when a sandbox exists on the provider, `null`
   *  when none. Absent ⇒ the server cannot discover un-tracked sandboxes.
   *  Never mutates provider state. */
  discover?(req: {
    readonly instanceId: string;
    readonly config: unknown;
    readonly env?: ReadonlyArray<readonly [string, string]>;
    /** Same namespace as `SandboxProvisionRequest.nameNamespace` when present. */
    readonly nameNamespace?: string;
  }): Effect.Effect<
    { readonly handle: SandboxHandle; readonly status: SandboxLifecycleStatus } | null,
    SandboxProviderError
  >;
}

/**
 * `SandboxProvider` — the frozen driver SPI.
 *
 * Required (every driver implements): `kind`, `validate`, `provision`, `exec`,
 * `reachability`, `dispose`, `describe`.
 *
 * Optional (driver may omit; registry exposes presence via `describe()` and
 * callers guard with capability checks): `snapshot` (snapshot lifecycle),
 * `renewTimeout` (extend session), `copyInto` (seed a repo archive into the
 * sandbox — Phase 2), `lifecycle` (durable stop/start — replaces `resume`).
 */
export interface SandboxProvider {
  readonly kind: SandboxProviderDriverKind;
  /** Credential/connectivity check ("Test connection"). */
  validate(config: unknown): Effect.Effect<void, SandboxProviderError>;
  /** Create/boot a sandbox, apply base image, (Phase 2: run `install`). */
  provision(req: SandboxProvisionRequest): Effect.Effect<SandboxHandle, SandboxProviderError>;
  /** Run a command in the sandbox. */
  exec(
    handle: SandboxHandle,
    command: string,
    opts?: { readonly cwd?: string; readonly user?: string },
  ): Effect.Effect<SandboxExecResult, SandboxProviderError>;
  /** Resolve how the client reaches a port, per `describe().reachabilityKind`. */
  reachability(
    handle: SandboxHandle,
    port: number,
  ): Effect.Effect<SandboxReachability, SandboxProviderError>;
  /** Tear down the sandbox. */
  dispose(handle: SandboxHandle): Effect.Effect<void, SandboxProviderError>;
  /** Capabilities, reachability kind, limits, which optional members exist. */
  describe(): Effect.Effect<SandboxProviderDescriptor, never>;
  /** Optional snapshot capability. Absent ⇒ `describe().supportsSnapshot === false`. */
  readonly snapshot?: SandboxSnapshotCapability;
  /** Optional renew-timeout capability. Absent ⇒ `describe().supportsRenewTimeout === false`. */
  readonly renewTimeout?: SandboxRenewTimeoutCapability;
  /** Optional copy-into capability (Phase 2 seeding). Absent ⇒ `describe().supportsCopyInto === false`. */
  readonly copyInto?: SandboxCopyIntoCapability;
  /** Optional durable lifecycle capability (stop/start/status). Absent ⇒ `describe().supportsLifecycle === false`. */
  readonly lifecycle?: SandboxLifecycleCapability;
  /**
   * Optional: when sandbox env is fixed at create time (Docker), return the
   * bootstrap token the in-sandbox server actually booted with. Absent ⇒
   * callers keep the freshly minted token (Vercel relaunches with new env).
   */
  readonly resolveBootstrapToken?: (
    handle: SandboxHandle,
    mintedToken: string,
  ) => Effect.Effect<string, SandboxProviderError>;
}

/**
 * Decode a driver-specific `config` payload (`Schema.Unknown` at the contract
 * layer) into a driver-owned typed shape. A driver registers a decoder with the
 * registry; the registry calls it when materializing an instance and marks the
 * instance `invalid-config` if decoding throws.
 *
 * Modeled as a plain function (throws on invalid) rather than a `Schema` so the
 * registry does not depend on a specific effect `Schema` decode API surface.
 */
export type SandboxProviderConfigDecoder<A> = (input: unknown) => A;
