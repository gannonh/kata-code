---
type: ADR
title: "Vercel Sandbox as the first cloud sandbox driver"
description: "Supersede the Railway Service Phase 3b decision and select Vercel Sandbox as the first BYOC cloud sandbox provider because its ephemeral microVM, snapshot, resume, timeout-extension, and public port model better matches Kata's task-environment shape."
tags: [adr, environments, deployments, sandbox, vercel, railway, byoc]
timestamp: 2026-07-05T00:00:00Z
---

# ADR 0007: Vercel Sandbox as the first cloud sandbox driver

## Status

Accepted. Supersedes [ADR 0006 — Sandbox provider auth model and Railway as the first cloud driver](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md) for the Phase 3b cloud provider choice. Keeps ADR 0006's provider-auth model.

## Context

[ADR 0006](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md) selected Railway Service as the first cloud driver after Phase 3a exposed the real prerequisite: the sandbox image needed provider CLIs, a working terminal, and a credential model. Railway Service was attractive because it runs ordinary Docker images and keeps the Phase 3a image as the deployment primitive.

Re-reviewing the choice against Task Mode and the Environments roadmap changes the weighting. Kata's long-term cloud requirement is an ephemeral task sandbox that can start quickly, run agent commands, preserve useful filesystem state, snapshot/fork/resume, and disappear cleanly. Railway Service is a service deployment primitive. It is useful for long-lived `katacode serve`, but it has slow deploy/pull/health-check startup and no first-class sandbox snapshot/fork model.

Vercel Sandbox now better matches the intended shape:

- It runs isolated Firecracker microVMs.
- It exposes command/file APIs through `@vercel/sandbox`.
- It supports persistent filesystem snapshots by default.
- It supports named sandbox resume and explicit snapshot creation.
- It supports public port URLs through `sandbox.domain(port)`.
- It supports timeout extension and now documents up to 24-hour Pro/Enterprise sessions, with 45 minutes on Hobby.
- Vercel documented p75 snapshot restore improvement from over 40 seconds to under one second.
- Custom VCR images are documented in beta, reducing the older "no custom image" concern from ADR 0005.

Railway Sandbox is also directionally strong: it has ephemeral VMs, exec, files, checkpoints, forks, templates, and port forwarding. It remains in Priority Boarding with breaking-change risk. It should be spiked after Vercel rather than blocking Phase 3b.

## Decision

1. **Vercel Sandbox is the Phase 3b cloud sandbox driver.** Implement `packages/sandbox-vercel` against the frozen `SandboxProvider` SPI using `@vercel/sandbox`.
2. **Railway Service is removed from Phase 3b.** It becomes a future service-deploy target, not the first cloud sandbox implementation.
3. **Railway Sandbox moves to the future cloud sandbox list.** Revisit when its SDK/API stabilizes or when Railway-native workflows become a near-term priority.
4. **Keep ADR 0006's provider-auth model.** Local Docker still bind-mounts host credentials. Cloud drivers seed credential files from a host-side encrypted store and keep env-var API keys as an alternative.
5. **Use Vercel's sandbox lifecycle directly.** The driver implements optional `snapshot`, `renewTimeout`, and `copyInto` capabilities. It provisions from a runtime, VCR image, or prepared snapshot; exposes `sandbox.domain(port)`; extends timeout while active; surfaces lapsed/resume states; and deletes sandboxes on dispose.
6. **Measure provider performance by time-to-usable sandbox.** Phase 3b validation records `create -> seed -> setup -> healthz -> Connect registered` time. This is the user-facing performance metric.

## Consequences

- [Phase 3b](/specs/2026-07-04-kata-environments-deployments-phase-3b-design.md) is rewritten for Vercel Sandbox: `packages/sandbox-vercel`, Vercel token trio, runtime/image/snapshot source, `sandbox.domain(port)`, `extendTimeout`, snapshot/resume, and Vercel credentialed UAT.
- The [Environments/Deployments roadmap](/specs/2026-06-27-kata-environments-deployments-design.md) is updated so Phase 3b is Vercel Sandbox and future providers include Railway Sandbox, Railway Service, E2B, Daytona, and Hetzner.
- ADR 0006 is marked superseded by this ADR for provider choice, but remains the accepted source for the credential model unless a later ADR replaces it.
- The official GHCR image publish requirement from the Railway Service plan is no longer a Phase 3b prerequisite. A VCR image pipeline may still be added if measurements justify it.
- Vercel platform limits become Phase 3b constraints: built-in runtimes use Amazon Linux 2023, VCR images are beta, default timeout is 5 minutes, Hobby max is 45 minutes, Pro/Enterprise max is 24 hours, and built-in provisioning currently runs in `iad1`.
- Docker-native environment configs fail loud on the Vercel driver in V1. Local Docker and future Railway/E2B/Hetzner drivers can cover Docker-required tasks.

## Related

- [Phase 3b — Vercel Sandbox cloud driver](/specs/2026-07-04-kata-environments-deployments-phase-3b-design.md)
- [Phase 3a — Docker sandbox gaps](/specs/2026-07-04-kata-environments-deployments-phase-3a-design.md)
- [Environments/Deployments roadmap](/specs/2026-06-27-kata-environments-deployments-design.md)
- [Superseded ADR 0006](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md)
- Vercel docs: [Sandbox](https://vercel.com/docs/sandbox), [Concepts](https://vercel.com/docs/sandbox/concepts), [SDK Reference](https://vercel.com/docs/sandbox/sdk-reference), [Duration and persistence](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence), [Snapshot restore performance](https://vercel.com/blog/optimizing-vercel-sandbox-snapshots)
