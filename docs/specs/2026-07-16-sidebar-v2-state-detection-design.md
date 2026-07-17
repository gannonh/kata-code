---
type: Spec
title: "Sidebar v2: shell attention-state detection"
description: "Make live Waiting / Working / Blocked sub-states trustworthy by auditing and fixing OrchestrationThreadShell projection writers — keep the client state machine pure."
status: Verified
approved_at: 2026-07-16T23:45:00Z
implemented_at: 2026-07-17T00:30:00Z
verified_at: 2026-07-17T00:00:00Z
tags: [web, sidebar, orchestration, projection, ux]
timestamp: 2026-07-17T00:30:00Z
related:
  - /specs/2026-07-14-sidebar-v2-hybrid-design.md
  - /specs/2026-07-16-sidebar-v2-active-idle-design.md
  - /guides/sidebar-v2-uat-playground.md
---

# Sidebar v2: shell attention-state detection

## Status

**Verified** (2026-07-17). Build shipped Phases A–B4: shell projection writers
and tests land for approvals (revert prune), user-input open/clear (+ Codex
`itemId` fallback), plan-ready shell flag, and `lastError` clear/retain.
Client `Sidebar.logic` unchanged. Live Waiting E2E deferred
([#39](https://github.com/gannonh/kata-code/issues/39)). Maintainer UAT passed
live Waiting (approval + Claude Ask + Codex Plan-mode Ask) and Blocked
(provider startup failure + recovery) without playground seeding.

## Goal

When a live session is waiting on the user, running, or failed, the Active
sidebar card shows the matching sub-state chip **without** a second client
inference layer.

Source of truth remains:

```text
provider runtime event
  → orchestration projection (counts / session row)
  → OrchestrationThreadShell booleans
  → Sidebar.logic resolveThreadStatusPill / SubState / Section
  → ThreadItemV2 chrome
```

### Glossary

| Term                    | Meaning                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| Sub-state `waiting`     | Chip: Pending Approval / Input / Plan Ready                         |
| Sub-state `working`     | Chip: Working / Connecting                                          |
| Sub-state `blocked`     | Chip: Failed (`session.lastError`)                                  |
| Sub-state `settled`     | Quiet Active (dwell) or Idle after timer / Sleep                    |
| Server `session.status` | Orchestration: `starting` \| `running` \| `ready` \| `stopped` \| … |
| Client session status   | Legacy map: orchestration `starting` → UI `connecting` (`store.ts`) |

## Verified current state

### Client (done — do not rework)

- `resolveThreadStatusPill` → `resolveThreadTier` / `resolveThreadSubState` →
  `resolveThreadSection` (+ pin / sleep / dwell) in
  `apps/web/src/components/Sidebar.logic.ts`.
- Plan Ready chip also requires `interactionMode === "plan"` and settled
  latest turn (client rule; shell flag alone is necessary but not sufficient).
- Fixtures + `/playground/sidebar` + Vitest browser suite prove UI when shell
  flags are seeded correctly
  ([UAT guide](/guides/sidebar-v2-uat-playground.md)).

### Shell predicates (locked)

| Sub-state | Shell / session inputs                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| waiting   | `hasPendingApprovals` \| `hasPendingUserInput` \| actionable plan (`hasActionableProposedPlan` + plan mode) |
| working   | **Server:** `session.status` ∈ {`starting`, `running`}. **Client pill:** mapped `connecting` or `running`   |
| blocked   | `session.lastError` (and no higher-priority pill)                                                           |
| settled   | none of the above                                                                                           |

### Projection writers (the work)

Counts are recomputed in `refreshThreadShellSummary`
(`apps/server/src/orchestration/Layers/ProjectionPipeline.ts`):

| Persisted field             | Derivation                                                                  |
| --------------------------- | --------------------------------------------------------------------------- |
| `pendingApprovalCount`      | `projection_pending_approvals` rows with `status === "pending"`             |
| `pendingUserInputCount`     | open `user-input.requested` activities minus resolved / stale-fail clears   |
| `hasActionableProposedPlan` | latest plan for `latestTurnId` (else latest plan) with `implementedAt` null |

Mapped to shell booleans in `ProjectionSnapshotQuery.ts`
(`count > 0` / int → boolean).

`session.status` / `session.lastError` come from `thread.session-set` →
`projection_thread_sessions` (ingestion in `ProviderRuntimeIngestion.ts`,
command reactor binds/stops). Ingestion already clears `lastError` when
mapping to healthy `ready`; stop paths may preserve it intentionally.

`refreshThreadShellSummary` already runs on message / plan / activity /
approval-response / user-input-response / session-set / turn-diff / revert.
**Missing refresh hooks are not the primary bug class** — data/logic gaps are.

### Known live gaps (audit seeds)

1. **Non-stale respond failures** leave pending approval / user-input counts
   true (intentional today; locked below).
2. **Checkpoint revert** refreshes shell but does **not** prune
   `projection_pending_approvals` → stale `hasPendingApprovals` (**bug**).
3. **`lastError` path ownership** spans ingestion + command reactor (stop /
   turn-start failure), not projection-only.
4. **Activities without `requestId`** never increment pending user-input
   (server + client `session-logic` share this rule) — may require adapter /
   ingestion payload fixes.
5. **Pi** has no approval shell path (`respondToRequest` stub); user-input
   works. Do not invent Pi approvals in this ship.
6. **Test hole:** tests often assert activities/columns, not
   `OrchestrationThreadShell` booleans via `ProjectionSnapshotQuery`.

Live UAT symptom: mostly Working / settled chips because Waiting / Blocked
flags stay false (or stuck true) when projection data diverges from chat
detail activities.

**Side effect risk:** Fixing stuck-false flags may wake Sleep-overridden
threads back to Active when attention sub-state becomes non-settled (parent
Sleep clear rule). Expected; note in UAT.

## Hard scope boundary

- **In scope:**
  - `ProjectionPipeline` / pending-approval prune / shell summary correctness
  - `ProviderRuntimeIngestion` + provider adapters as needed for
    `user-input.requested` `requestId` fidelity
  - Session `lastError` clear/retain paths in ingestion + command reactor
  - `ProjectionSnapshotQuery` boolean mapping tests
  - Focused projection/ingestion tests; optional Working live E2E
- **Out of scope:**
  - Client-side inference / dual state machines in `apps/web`
  - New `attentionState` enum on the shell contract
  - Environments / sandbox / BYOC
  - Inline Approve / Review on Waiting cards
  - Pi approval UX
  - Active/Idle presentation, dwell, Sleep/Pin redesign
  - Full OpenCode / Grok / Cursor inventory (best-effort via shared ingestion
    only; not AC1 gate)

## Decisions (lock on approval)

| Decision            | Value                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture        | Fix projection + ingestion/adapters; keep `Sidebar.logic` pure over shell fields                                                                                                     |
| Stuck-true policy   | **Locked:** Non-stale approval/user-input respond failures do **not** clear pending shell flags. Clear only via resolve, recognized stale-fail detail, or revert prune               |
| Blocked / lastError | **Locked:** Healthy `ready` after successful turn / session recovery → `lastError` null. Explicit stop / error / turn-start-failure retention stays as today’s intentional semantics |
| Providers (AC gate) | Codex + Claude (approvals + user-input); Pi user-input only. OpenCode/Grok/Cursor: shared-ingestion best-effort, not inventory AC                                                    |
| Contract change     | None unless audit finds a missing observable the shell cannot express                                                                                                                |
| UI changes          | None required; chips already consume pills                                                                                                                                           |
| Live Waiting E2E    | **Optional / non-blocking** — defer via GitHub deferred-work issue if harness cannot force approval/ask prompts                                                                      |

## Design

### Phase A — Inventory matrix (read-only deliverable)

Produce a matrix (spec appendix or short guide) for **Codex, Claude, Pi**:

| Signal             | Runtime event(s)                      | Projection / derive                    | Shell field                 | Expected clear                      |
| ------------------ | ------------------------------------- | -------------------------------------- | --------------------------- | ----------------------------------- |
| Pending approval   | `approval.requested` / request.opened | `projection_pending_approvals`         | `hasPendingApprovals`       | resolve / stale-fail / revert prune |
| Pending user input | `user-input.requested`                | activities + `derivePendingUserInput…` | `hasPendingUserInput`       | resolve / stale-fail                |
| Plan ready         | proposed-plan upsert                  | `deriveHasActionableProposedPlan`      | `hasActionableProposedPlan` | implemented / superseded            |
| Working            | turn.started / session.state          | `projection_thread_sessions.status`    | `starting`/`running`        | turn complete / ready               |
| Blocked            | turn/session error                    | `session.lastError`                    | lastError                   | healthy ready after success         |

Mark each cell: **OK / bug / N/A (Pi approvals)**.

### Phase B — Fix writers (TDD)

Vertical slices, one flag family at a time:

1. **Approvals** — prune `projection_pending_approvals` on checkpoint revert;
   keep non-stale failure stickiness; assert shell booleans via snapshot query.
2. **User input** — ensure `requestId` on Codex/Claude/Pi Ask paths
   (adapters + ingestion as needed); clear on resolve; parity with
   `derivePendingUserInputs` fixtures.
3. **Plan ready** — upsert → shell true; implement → shell false;
   latest-turn scoping; document client plan-mode + settled-turn gating.
4. **Session error** — owners: `ProviderRuntimeIngestion.ts` +
   `ProviderCommandReactor.ts`. Cases: recoverable success clears Failed;
   explicit stop/error retains Failed until healthy ready.

Each slice: failing test → fix → green. Assert **shell summary columns and
`OrchestrationThreadShell` booleans**, not only activity rows.

### Phase C — Client contract guardrails

- `Sidebar.logic.test.ts` only if pill priority needs a documented edge
  (e.g. plan-ready vs stale lastError) — no new client derivation.
- Comment-only shell→sub-state map optional. **Defer** `agentAwareness.ts`
  behavioral alignment (different status vocabulary); out of ship gate.

### Phase D — Live verification (optional)

| Live slice                        | Tag        | Gate                                   |
| --------------------------------- | ---------- | -------------------------------------- |
| Working chip during a turn        | `@sidebar` | Preferred if cheap                     |
| Working → settled after turn ends | `@agent`   | Preferred if cheap                     |
| Approval / Ask → Waiting chip     | `@agent`   | **Non-blocking**; defer if unforceable |

Ship gate = projection + snapshot-query tests + maintainer UAT checklist.
Do not block on flaky real-LLM Waiting prompts.

## Acceptance criteria

1. **Inventory:** Phase A matrix in-repo with OK/bug/N/A for Codex, Claude, Pi
   × each signal row above.
2. **Approvals:** For fixture-equivalent activity sequences, shell
   `hasPendingApprovals` matches client `derivePendingApprovals`. Resolve and
   stale-fail clear the flag. Checkpoint revert does not leave orphan pending
   approval counts. Non-stale respond failure **keeps** the flag true.
3. **User input:** Same parity with `derivePendingUserInputs` when the
   provider emits `user-input.requested` with `requestId` (Codex + Claude +
   Pi user-input required; Pi approvals N/A).
4. **Plan ready:** Actionable proposed plan for the latest turn sets
   `hasActionableProposedPlan`; implementing / clearing clears it. Plan Ready
   **chip** still requires existing client rules
   (`interactionMode === "plan"` + settled latest turn) — unchanged.
5. **Working:** Server `starting`/`running` (client `connecting`/`running`)
   maps to Working sub-state without client inference.
6. **Blocked:**
   - Recoverable success (`turn.completed` success or session → healthy
     `ready`): `lastError` null; Failed chip clears.
   - Explicit stop / error / turn-start-failure: `lastError` retained; Failed
     chip remains until healthy ready. Covered by ingestion/reactor tests.
7. **No dual SM:** No new client-side pending/error inference for sidebar
   chips; `Sidebar.logic` continues to read shell fields only.
8. **Regression:** `Sidebar.logic` + SidebarV2 browser fixtures stay green.
   Each fixed flag family has tests asserting projection columns **and**
   `OrchestrationThreadShell` booleans via `ProjectionSnapshotQuery` (or
   equivalent store mapping).
9. **Boundary:** No environments/sandbox/BYOC contract or service changes.
10. **Maintainer UAT (non-gating):** On a real project, at least one Waiting
    (approval or ask) and one Blocked (forced error) path show correct Active
    chips without playground seeding. Checklist steps belong in the UAT guide;
    failure files a deferred-work issue rather than blocking CI.

## Build handoff

### Phases

| Phase | Work                                                                        |
| ----- | --------------------------------------------------------------------------- |
| A     | Inventory matrix (Codex / Claude / Pi)                                      |
| B1    | Approvals: revert prune + shell boolean tests; keep non-stale stickiness    |
| B2    | User-input: `requestId` fidelity (adapters/ingestion) + shell boolean tests |
| B3    | Plan-ready shell summary + snapshot-query tests                             |
| B4    | `lastError` clear/retain cases in ingestion + command reactor               |
| C     | Client guardrails only if needed; awareness alignment deferred              |
| D     | Optional Working live E2E; Waiting live → deferred-work if unforceable      |

### Verification commands

```bash
vp check
vp run typecheck
vp run --filter @kata-sh/code-server test -- src/orchestration/Layers/ProjectionPipeline.test.ts
vp run --filter @kata-sh/code-server test -- src/orchestration/Layers/ProjectionSnapshotQuery.test.ts
vp run --filter @kata-sh/code-server test -- src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
vp run --filter @kata-sh/code-web test -- src/components/Sidebar.logic.test.ts
vp run --filter @kata-sh/code-web test:browser -- src/components/sidebar/SidebarV2.browser.tsx
# Optional live (stop local dev first):
vp run e2e --project desktop-dev --grep '@sidebar|@agent'
```

### Non-goals

- Client inference fallbacks
- Shell `attentionState` enum
- Pi approval product work
- Inline Approve / Review
- Active/Idle UX / dwell / Sleep/Pin changes
- Gating CI on real-LLM Waiting prompts

## Related

- Parent presentation: [Sidebar v2 hybrid](/specs/2026-07-14-sidebar-v2-hybrid-design.md)
- List model: [Active / Idle](/specs/2026-07-16-sidebar-v2-active-idle-design.md)
- UAT: [playground-first guide](/guides/sidebar-v2-uat-playground.md)
- Writers: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- Readers: `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- Ingestion: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- Stop/error: `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- Client SM: `apps/web/src/components/Sidebar.logic.ts`
- Chat pending derive: `session-logic` `derivePendingApprovals` /
  `derivePendingUserInputs`

## Appendix A — Inventory matrix (Phase A)

Built during Build Phase A from projection/ingestion/adapters audit.

| Provider | Signal             | Status | Notes                                                                                                          |
| -------- | ------------------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| Codex    | Pending approval   | bug    | Works via `request.opened`, but checkpoint revert does not prune orphan `projection_pending_approvals` rows.   |
| Codex    | Pending user input | OK     | Runtime mints UUID `requestId`; adapter falls back to `itemId` if omitted; shell open/clear projection-tested. |
| Codex    | Plan ready         | OK     | Proposed-plan upsert → shell flag; clears on `implementedAt`.                                                  |
| Codex    | Working            | OK     | `starting` / `running` via `thread.session-set`.                                                               |
| Codex    | Blocked            | OK     | Failed turn/session sets `lastError`; healthy `ready` clears in ingestion.                                     |
| Claude   | Pending approval   | bug    | Same revert orphan as Codex.                                                                                   |
| Claude   | Pending user input | OK     | `AskUserQuestion` always synthesizes `requestId`.                                                              |
| Claude   | Plan ready         | OK     | `ExitPlanMode` → proposed-plan path.                                                                           |
| Claude   | Working            | OK     | Shared session-set path.                                                                                       |
| Claude   | Blocked            | OK     | Shared `lastError` / clear-on-ready path.                                                                      |
| Pi       | Pending approval   | N/A    | No enforceable approval gate (`respondToRequest` stub).                                                        |
| Pi       | Pending user input | OK     | Extension bridge always assigns `requestId`.                                                                   |
| Pi       | Plan ready         | N/A    | No `turn.proposed.*` path.                                                                                     |
| Pi       | Working            | OK     | `turn.started` → `running` (no separate `starting`).                                                           |
| Pi       | Blocked            | OK     | Shared `lastError` / clear-on-ready path.                                                                      |

Cross-cutting: refresh hooks exist; gaps are data/logic. Non-stale respond failures keeping pending flags is intentional (locked). Client Plan Ready still requires plan mode + settled turn.
