---
type: Spec
title: "Kata Environments / Deployments Phase 0 — SandboxProvider foundations"
description: "Detailed design for the SandboxProvider SPI, schema-only contracts, settings map, registry, test-only stub driver, and a local-container feasibility spike. No user-facing surface; no driver shipped."
status: Draft
tags: [specs, phase-0, environments, deployments, sandbox, spi, contracts, docker]
timestamp: 2026-06-27T16:35:04Z
---

# Kata Environments / Deployments Phase 0 — SandboxProvider foundations

## Status

Draft

## Goal

Establish the modular sandbox-provider substrate with no user-facing surface. Phase 0 ships the
schema-only contracts, the capability-based `SandboxProvider` driver SPI, a registry that
materializes instances from settings and downgrades unknown drivers gracefully, the
`sandboxProviderInstances` settings field, a test-only stub driver, and a recorded local-
container feasibility spike. No production driver is registered; the server boots unchanged.

This is the first per-phase spec under the
[Kata Environments — deployments (BYOC) roadmap](/specs/2026-06-27-kata-environments-deployments-design.md).
It implements roadmap Phase 0 and freezes the SPI shape every later phase depends on.

## Source of truth

- Master roadmap: [2026-06-27-kata-environments-deployments-design.md](/specs/2026-06-27-kata-environments-deployments-design.md)
  (Phase 0 requirements, AC-0.1…AC-0.7; capability-based SandboxProvider SPI; container-first).
- Existing provider-instance pattern to mirror: `packages/contracts/src/providerInstance.ts`
  (`ProviderDriverKind` open slug, `ProviderInstanceId`, `ProviderInstanceConfig` envelope,
  `defaultInstanceIdForDriver`), `packages/contracts/src/settings.ts`
  (`providerInstances` map, whole-map patch).
- Existing `AdvertisedEndpoint` / reachability model to reuse:
  `packages/contracts/src/remoteAccess.ts`
  (`AdvertisedEndpointReachability: loopback | lan | private-network | public`,
  `AdvertisedEndpointProviderKind`), `packages/shared/src/advertisedEndpoint.ts`.
- Secret-storage infra to reuse: `apps/server/src/auth/ServerSecretStore.ts` (out-of-band
  `0o600` file store), `apps/server/src/serverSettings.ts`
  (`materializeProviderEnvironmentSecrets` / `persistProviderEnvironmentSecrets` redaction).
- Prior-art SPI shape: AgentBox `packages/core/src/cloud-backend.ts` and
  `packages/sandbox-docker/src/*` (`/Volumes/EVO/repos/agentbox`; pattern reference only).
- Container runtime for the spike: local Docker or OrbStack; no credentials required.

## Locked decisions (from roadmap + planning)

1. **New packages, no server wiring.** Phase 0 adds `packages/sandbox-contracts` and
   `packages/sandbox`, plus `sandboxProviderInstances` in `ServerSettings`. No
   `environments.deploy.*`/`sandbox.*` RPCs, no registry wiring into running server layers. The
   server boots unchanged (AC-0.4).
2. **Distinct from `apps/server/src/cloud/`.** That directory is **Kata Code Connect** (relay
   CLI state, endpoints, environment keys) — a different concern. Phase 0 does not touch it.
   The new packages are `@kata-sh/code-sandbox-contracts` and `@kata-sh/code-sandbox`.
3. **Capability-based SPI.** Required primitives + optional capabilities; registry checks
   presence and degrades gracefully. Frozen in this spec (see SPI section).
4. **Secret-storage bar reuses existing infra.** Sandbox credentials and env secrets use the
   same `sensitive` + `valueRedacted` envelope and `ServerSecretStore` out-of-band file path as
   `providerInstances`. No plaintext in settings JSON. The existing
   `materializeProviderEnvironmentSecrets` / `persistProviderEnvironmentSecrets` helpers are
   hardcoded to iterate `settings.providerInstances`; a later phase generalizes them to also
   walk `sandboxProviderInstances` (extract to a shared helper — no duplication). Phase 0 only
   fixes the contract shape so that generalization is mechanical and ships no writer for the
   field, so "no plaintext in settings" is a contract decision here, not yet an enforced/tested
   invariant.
5. **Container spike is a throwaway script + recorded findings.** Lives under
   `scripts/sandbox-spike/`, not shipped as product code. Findings recorded in this spec. No
   credentials needed; runnable on the dev machine and in CI.

## Current state (verified)

- `ServerSettings` (`packages/contracts/src/settings.ts`) carries
  `providerInstances: Record<ProviderInstanceId, ProviderInstanceConfig>` with a whole-map patch
  field and decodes unknown driver kinds without loss (documented invariant in
  `providerInstance.ts`).
- `AdvertisedEndpoint` + `AdvertisedEndpointReachability` (`loopback | lan | private-network |
public`) already exist in `packages/contracts/src/remoteAccess.ts` — Phase 0's
  `SandboxReachabilityKind` maps onto these, not a new axis.
- `ServerSecretStore` persists secrets as `<secretsDir>/<name>.bin` (dir `0o700`, files `0o600`,
  atomic temp-write+rename) and backs provider-instance sensitive env vars via redaction in
  `serverSettings.ts`.
- Packages use subpath `exports` pointing at `src/*.ts`, `tsgo --noEmit` for typecheck,
  `vite-plus` (`vp test`) for tests, `effect` from the workspace catalog. New packages follow
  the same conventions. `pnpm-workspace.yaml` already globs `packages/*`.
- `apps/server/src/cloud/` exists and is Kata Code Connect; out of scope here.

## Architecture

Two new packages, mirroring the AgentBox split (contracts vs scaffolding) and the existing Kata
provider layering (schema-only contracts vs runtime registry). Reachability maps onto the
existing `AdvertisedEndpointReachability` model.

```mermaid
flowchart TB
  subgraph contracts["packages/sandbox-contracts (schema-only)"]
    K["SandboxProviderDriverKind (open slug)"]
    I["SandboxProviderInstanceId"]
    E["SandboxProviderInstanceConfig (envelope)"]
    EC["EnvironmentConfig (.kata/environment.json)"]
    S["SandboxSessionState"]
    R["SandboxReachabilityKind"]
  end
  subgraph sandbox["packages/sandbox (runtime)"]
    SPI["SandboxProviderDriver SPI (required + optional)"]
    REG["SandboxProviderRegistry (materialize, downgrade unknown)"]
    STUB["stub driver (test-only, out of exports)"]
  end
  settings["ServerSettings.sandboxProviderInstances{}"]
  contracts --> sandbox
  settings --> REG
  REG --> SPI
  STUB -. implements .-> SPI
```

### `packages/sandbox-contracts` (schema-only)

Mirrors `providerInstance.ts` discipline: no runtime logic, open branded slugs, unknown drivers
round-trip. Exports (each as a subpath export):

- `SandboxProviderDriverKind` — open branded slug (same slug rules as `ProviderDriverKind`:
  starts with a letter, `[a-zA-Z0-9_-]`, 1..64 chars). Not a closed union; unknown kinds parse
  successfully and the registry marks them unavailable.
- `SandboxProviderInstanceId` — user-defined routing-key slug, branded separately (with a
  distinct brand string, e.g. `"SandboxProviderInstanceId"`, not reusing the existing
  `ProviderInstanceId` brand, so the type systems cannot be confused).
- `defaultInstanceIdForDriver(kind)` — canonical back-compat instance id (mirrors the provider
  helper).
- `SandboxProviderInstanceConfig` — envelope: `{ driver, displayName?, enabled?, environment?,
config? }` where `config` is `Schema.Unknown` (driver owns its schema) and `environment`
  reuses the **same** `ProviderInstanceEnvironment` shape (`name`, `value`, `sensitive`,
  `valueRedacted?`) so the existing secret redaction path applies unchanged.
- `SandboxProviderInstanceConfigMap` — `Record<SandboxProviderInstanceId, SandboxProviderInstanceConfig>`.
- `EnvironmentConfig` — schema for `.kata/environment.json`: `{ build?: { dockerfile, context? },
snapshot?, install?, start?, terminals? }`. All fields optional; unknown fields tolerated
  (forward-compat). Schema only; no resolver logic here (resolver is Phase 2).
- `SandboxSessionState` — literal union: `provisioning | ready | error | disposed` (plus
  `unknown` for forward-compat). Used by later phases; defined now so the contract is stable.
- `SandboxReachabilityKind` — maps onto the existing `AdvertisedEndpointReachability`:
  `loopback` (local-container) | `public` (cloud tunnel) | `private-network` (future ssh/tailnet).
  Phase 0 defines the literal; drivers map it to an `AdvertisedEndpoint` in later phases.

The `environment` field reuses the provider env shape deliberately: it lets a later phase
generalize the existing `materializeProviderEnvironmentSecrets`-style logic to also walk the
sandbox map (those helpers are currently hardcoded to `settings.providerInstances`). No second
redaction implementation. **`packages/sandbox-contracts` depends on `@kata-sh/code-contracts`**
to import `ProviderInstanceEnvironment` rather than redefine it — single-sources the redaction
contract (declared in the scaffold step below).

### `packages/sandbox` (runtime SPI + registry)

#### SandboxProviderDriver SPI (frozen shape)

Required (every driver implements): `kind`, `validate`, `provision`, `exec`, `reachability`,
`dispose`, `describe`.

| Member                       | Purpose                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`                       | `SandboxProviderDriverKind` identity.                                                                                                                                       |
| `validate(config)`           | Credential/connectivity check ("Test connection").                                                                                                                          |
| `provision(req)`             | Create/boot a sandbox, apply base image/snapshot, run `install`.                                                                                                            |
| `exec(handle, cmd, opts?)`   | Run a command in the sandbox.                                                                                                                                               |
| `reachability(handle, port)` | Resolve how the client reaches a port, per `describe().reachabilityKind`; returns an `AdvertisedEndpoint`-shaped result (loopback URL for container, tunnel URL for cloud). |
| `dispose(handle)`            | Tear down the sandbox.                                                                                                                                                      |
| `describe()`                 | Capabilities, `reachabilityKind`, limits, which optional members exist.                                                                                                     |

Optional (driver may omit; registry exposes presence via `describe()` and callers guard with
capability checks): `createSnapshot` / `deleteSnapshot` / `snapshotExists` (snapshot lifecycle,
Phase 5), `renewTimeout` (extend session, Phase 3/4), `signedPreviewUrl` (Phase 4),
`networkPolicy` (later), `pause` / `resume` (where supported).

`describe()` returns a `SandboxProviderDescriptor`: `{ kind, reachabilityKind, maxLifetimeMs?,
supportsSnapshot, supportsRenewTimeout, baseImages? }`. Each boolean capability flag is `true`
only when **all** of that capability's methods are present (e.g. `supportsSnapshot` requires
`createSnapshot` AND `deleteSnapshot` AND `snapshotExists`). Flags must agree with method
presence (asserted in tests).

`SandboxProviderError` is a tagged Effect error with a `reason` and optional `cause`, so
failures are explicit (no silent fallback — roadmap constraint).

This SPI is **frozen by this spec**. Later phases may add optional capabilities but must not
change required signatures without a spec amendment.

#### SandboxProviderRegistry

- Built from a `SandboxProviderInstanceConfigMap` plus registered drivers keyed by
  `SandboxProviderDriverKind`.
- `materialize()` produces, per instance id, either an **available** materialized instance
  (driver found, config decodes) or an **unavailable** record carrying the reason
  (`unknown-driver` | `disabled` | `invalid-config`). Never throws on unknown driver (mirrors
  `ProviderInstanceRegistry` and the contract invariant).
- `get(instanceId)` returns the materialized instance or an unavailable marker.
- `list()` returns all materialized instances (available + unavailable) for UI/diagnostics.
- No process/resource lifecycle in Phase 0 (no real driver runs); the registry is pure
  resolution over config + driver set.

#### Stub driver (test-only)

An in-memory driver implementing the full required SPI plus a configurable subset of optional
capabilities, used to test the registry and capability-presence logic. It is **not** declared in
`package.json#exports` at all — it lives under `packages/sandbox/src/testing/` and is imported
only via a relative path from co-located tests. Keeping it out of `exports` is what actually
prevents accidental production registration (a subpath export would remain importable in
production).

### `ServerSettings.sandboxProviderInstances`

Add to `ServerSettings` (and `ServerSettingsPatch` as a whole-map optional field, matching
`providerInstances`):

```
sandboxProviderInstances: Schema.Record(SandboxProviderInstanceId, SandboxProviderInstanceConfig)
  .pipe(Schema.withDecodingDefault(Effect.succeed({})))
```

Decoding an unknown driver kind in this map must succeed and round-trip the envelope verbatim
(AC-0.2). No server-layer reads this field yet (AC-0.4). **Connect auto-registration is a
Phase 1+ enforced constraint** (roadmap key decision 4; tested by AC-1.4 for containers and
AC-3.4 for cloud), not a Phase 0 invariant — Phase 0 ships no driver and no provision path.

### Container feasibility spike (gates Phase 1 risk, not Phase 0 merge)

A throwaway script `scripts/sandbox-spike/container-reachability.ts` (run locally; no
credentials) that:

1. Provisions a container via the local Docker/OrbStack API.
2. Starts a trivial listener (HTTP + WebSocket) on a port inside the container.
3. Publishes/maps that port to `localhost` on the host.
4. Opens a `ws`/`wss` connection to `localhost:<port>` and exchanges a message.
5. Confirms a long-lived server process (a `katacode serve`-equivalent stub) runs cleanly
   inside the container and is reachable after the port mapping.

Findings (pass/fail per step and the verified runtime API surface) are recorded in this spec's
**Spike findings** section. A refutation blocks Phase 1 until container reachability is
re-planned. Unlike a cloud spike, this needs no credentials and runs in CI.

## Acceptance criteria

1. **AC-0.1** `packages/sandbox-contracts` and `packages/sandbox` build and pass
   `vp run typecheck`; `vp check` is clean. Both are added to the workspace and resolve via
   subpath exports.
2. **AC-0.2** A unit test decodes a `sandboxProviderInstances` map containing a
   **valid-but-unregistered** driver kind (a well-formed slug matching
   `/^[a-zA-Z][a-zA-Z0-9_-]*$/`, not one the registry knows) and asserts the envelope
   round-trips (encode∘decode is identity) with no data loss. This exercises registry-unknown
   decoding, not schema-rejection of a malformed slug (which fails decode by design).
3. **AC-0.3** A unit test builds a `SandboxProviderRegistry` with the stub driver registered and
   asserts: (a) a stub instance materializes as available; (b) an unknown-driver instance is
   unavailable with reason `unknown-driver` and does not throw; (c) a `disabled` instance is
   unavailable with reason `disabled`; (d) an instance whose `config` fails the stub's decode is
   unavailable with reason `invalid-config`.
4. **AC-0.4** With `sandboxProviderInstances` present in `ServerSettings` (default `{}` and a
   populated unknown-driver entry), the server boots unchanged: existing server/settings tests
   pass and no production sandbox driver is registered.
5. **AC-0.5** `describe()` capability flags match method presence: a unit test asserts that for
   the stub driver, `supportsSnapshot === (createSnapshot && deleteSnapshot && snapshotExists
all present)` and likewise for `renewTimeout`, across at least one driver variant with the
   capability and one without. (A capability flag is true only when all of its methods are
   present.)
6. **AC-0.6** SPI freeze (process + drift guard): `SandboxProvider` required members (`kind`,
   `validate`, `provision`, `exec`, `reachability`, `dispose`, `describe`) exist with the
   documented shapes, covered by a type-level conformance test (the stub satisfies the
   interface) so an accidental change to a required signature breaks the build. The actual
   freeze is the process rule (no required-signature change without a spec amendment); this test
   is a drift guard, not a substitute.
7. **AC-0.7** Container spike delivered: `scripts/sandbox-spike/container-reachability.ts`
   exists and **typechecks under `vp run typecheck`** (so the Docker/OrbStack client dependency
   is real and resolved and the script compiles). The **Spike findings** section records
   pass/fail for provision, port publish to `localhost`, sustained `ws`/`wss`, and long-lived
   process, with the verified runtime API cited. If Docker/OrbStack is unavailable in the run
   environment, a "blocked: needs local Docker" finding satisfies this AC (the script still
   must typecheck); Phase 1 is then blocked until the spike actually runs. No credentials
   required; the script is runnable locally and in CI. A refutation blocks Phase 1 until
   re-planned.

AC-0.1…AC-0.4 map to the roadmap's AC-0.1…AC-0.4. The roadmap's container spike is
implemented here as AC-0.7 (the roadmap's AC-0.5/0.6/0.7 are reconciled to this spec's
AC-0.5=capability-flags / AC-0.6=SPI-freeze / AC-0.7=spike-delivered split).

## Implementation plan

1. **Scaffold `packages/sandbox-contracts`** — package.json (subpath exports, `effect` catalog,
   `tsgo`/`vp test`, **dependency on `@kata-sh/code-contracts`**), `tsconfig`, and schema
   modules: `driverKind.ts`, `instance.ts` (envelope + map + `defaultInstanceIdForDriver`),
   `environmentConfig.ts`, `sessionState.ts`, `reachability.ts`, `index.ts`. **Import and reuse
   `ProviderInstanceEnvironment` from `@kata-sh/code-contracts`** for `environment` — do not
   redefine. _(AC-0.1, AC-0.2)_
2. **Scaffold `packages/sandbox`** — package.json/tsconfig; `SandboxProviderDriver.ts` (SPI
   types + `SandboxProviderError`), `SandboxProviderRegistry.ts`, `descriptor.ts`, a test-only
   `testing/stubDriver.ts` (out of `exports`), `index.ts`. _(AC-0.3, AC-0.5, AC-0.6)_
3. **Add `sandboxProviderInstances`** to `ServerSettings` and `ServerSettingsPatch`
   (`packages/contracts/src/settings.ts`), with default `{}` and whole-map patch. _(AC-0.4)_
4. **Tests** — contracts round-trip (incl. unknown driver), registry materialization
   (available/unknown/disabled/invalid-config), descriptor↔method-presence agreement, settings
   decode with unknown sandbox driver, type-level SPI conformance. _(AC-0.2, AC-0.3, AC-0.4,
   AC-0.5, AC-0.6)_
5. **Container spike** — `scripts/sandbox-spike/container-reachability.ts`; run; record
   findings. _(AC-0.7)_
6. **Gate** — `vp check`, `vp run typecheck`, `vp run test`; record results. _(AC-0.1)_

Steps 1–2 can proceed in parallel after the contract names are fixed; step 5 is independent of
1–4 and can run anytime (no credentials).

## Out of scope

- Any `environments.deploy.*`/`sandbox.*` RPC or server-layer registry wiring (Phase 1+).
- The Docker/OrbStack driver implementation (`packages/sandbox-docker`) beyond the throwaway
  spike script (Phase 1).
- The `.kata/environment.json` resolver and execution (Phase 2) — Phase 0 defines the schema
  only.
- The Cloudflare driver (`packages/sandbox-cloudflare`) (Phase 3).
- Any UI (Settings/composer) — Phase 1+.
- Touching `apps/server/src/cloud/` (Kata Code Connect).
- Generalizing the secret-redaction helpers to walk `sandboxProviderInstances` (a later phase;
  Phase 0 only fixes the contract shape).

## Risks and mitigations

- **SPI mis-design forces later churn.** Mitigation: validate the required/optional split
  against AgentBox's `CloudBackend` (and its `sandbox-docker` driver) before finalizing; lock
  with a type-level conformance test (AC-0.6).
- **Reachability/`AdvertisedEndpoint` mapping drift.** Mitigation: `SandboxReachabilityKind`
  maps onto the existing `AdvertisedEndpointReachability` literals rather than introducing a
  parallel axis; a test asserts the **forward** mapping is total (every `SandboxReachabilityKind`
  maps to some `AdvertisedEndpointReachability` literal) — not the reverse (the existing `lan`
  literal is intentionally unused by any V1 sandbox kind).
- **Contract drift from `providerInstance.ts`.** Mitigation: import/reuse the existing
  `ProviderInstanceEnvironment` schema rather than redefining it, so the secret path stays
  single-sourced.
- **Spike can't run without Docker/OrbStack.** Mitigation: the spike is local and needs no
  credentials; if Docker is unavailable in a given environment, AC-0.7 is satisfied by the
  committed + typechecking script and a "blocked: needs local Docker" finding, and Phase 1
  cannot complete until the spike runs (it gates Phase 1 risk, not Phase 0 merge).

## Spike findings

_To be completed when `scripts/sandbox-spike/container-reachability.ts` runs (AC-0.7)._

- Provision (local container): _pending_
- Port publish to `localhost`: _pending_
- Sustained `ws`/`wss` to `localhost:<port>`: _pending_
- Long-lived server process runs cleanly + reachable: _pending_
- Verified Docker/OrbStack runtime API surface: _pending_
- Phase 1 gate decision: _pending_

## Build handoff

- **Approved scope:** two new packages (`sandbox-contracts`, `sandbox`), `sandboxProviderInstances`
  settings field, test-only stub driver, frozen capability-based SandboxProvider SPI,
  container-spike script + findings. No server wiring, no driver, no UI.
- **Non-goals:** RPCs, registry wiring, Docker driver, Cloudflare driver, resolver, UI, Connect
  changes, secret-redaction generalization.
- **Required verification:** AC-0.1…AC-0.7 + CI parity (`vp check`, `vp run typecheck`,
  `vp run test`).
- **Blocking questions:** none — all Phase 0 decisions locked. The spike result feeds Phase 1
  planning, not Phase 0 completion.
