---
type: Guide
title: "Sidebar v2 UAT — playground-first"
description: "Maintainer UAT and proof plan for attention-tier sidebar: fixture catalog → Vitest browser playground → live @sidebar/@agent E2E."
tags: [web, sidebar, ux, testing, uat, e2e]
timestamp: 2026-07-16T15:24:00Z
---

# Sidebar v2 UAT — playground-first

Companion to [Sidebar v2 attention tiers](/specs/2026-07-14-sidebar-v2-hybrid-design.md).
Pixel reference remains [`c-attention-session.html`](../comps/sidebar-v2-prototypes/c-attention-session.html);
**UAT and automated proof start from seeded fixtures**, not hand-built demo repos.

## Principle

One fixture catalog drives:

1. Maintainer UAT (real React sidebar, controlled states)
2. Vitest browser assertions (AC 2–6, 8)
3. Later live `@sidebar` / `@agent` E2E (only what fixtures cannot prove)

Do not build a separate “demo farm” and then rebuild the same seeds for tests.

## What’s already built vs what this plan proves

| Layer                                                                      | Status                          |
| -------------------------------------------------------------------------- | ------------------------------- |
| Product UI (tiers, picker, Idle expand, accordion, Failed→Blocked, timers) | **Built** on `sidebar-redesign` |
| Unit logic (`Sidebar.logic.ts`)                                            | **Proven**                      |
| `@sidebar` smoke (chrome + accordion)                                      | **Proven**                      |
| Populated-state browser fixtures / AC 11 visual sign-off                   | **This plan**                   |
| Live Working timer + tier transitions                                      | Phase 3 (cheap agent)           |
| Environments deploy regression                                             | Separate gate before merge      |

“Gaps vs AC” earlier meant **proof gaps**, not missing product features.

## Phases

### Phase 0 — Fixture catalog

Shared seeds under `apps/web/src/components/sidebar/fixtures/`:

| Scenario id      | Seeds                                                     |
| ---------------- | --------------------------------------------------------- |
| `mixed-tiers`    | Waiting + Working + Blocked + Idle                        |
| `waiting-only`   | Approval / awaiting-input / plan-ready                    |
| `working-timer`  | Running turn with `latestTurn.startedAt`                  |
| `blocked-failed` | Failed rich Blocked (+ visited slim red dot via UI state) |
| `idle-expand`    | Slim idle → click expand                                  |
| `picker-scope`   | ≥2 projects; scope + waiting-elsewhere hint               |
| `meta-remote`    | Chip · branch · time (+ remote badge when env differs)    |
| `scroll-30`      | 30+ non-archived threads                                  |

Shell snapshot flags (`hasPendingApprovals`, `hasPendingUserInput`, `hasActionableProposedPlan`, session `running` / `lastError`) must be set explicitly — browser harnesses that hardcode those flags to `false` will not exercise tiers.

### Phase 1 — Vitest browser playground (start here)

File: `apps/web/src/components/sidebar/SidebarV2.browser.tsx`

- Mounts the real app shell (same MSW/WS pattern as other `*.browser.tsx` suites)
- Scenario switcher pushes a new shell snapshot so you can walk states without re-seeding disk repos
- Automated `it`s assert tier headers / row contracts for each scenario

**Maintainer UAT**

```bash
# Headed UI — click scenarios, compare to C in another window
vp run --filter @kata-sh/code-web test --project browser --ui src/components/sidebar/SidebarV2.browser.tsx

# Optional long-lived interactive mount (see test name in file)
SIDEBAR_V2_PLAYGROUND=1 vp run --filter @kata-sh/code-web test --project browser -t "interactive playground"
```

Pixel reference:

```bash
docs/comps/sidebar-v2-prototypes/serve.sh
# → http://127.0.0.1:8765/c-attention-session.html
```

**Exit:** AC 11 visual sign-off on **populated** states (not empty chrome).

### Phase 2 — Promote fixtures → CI proof

Same scenarios stay as Vitest browser tests (no duplicate seeds). Extend `@sidebar` E2E only where a real project open + accordion path adds coverage beyond the browser harness.

**Exit:** AC 2–6, 8 fixture-covered; AC 1 / no show-more already partly covered by smoke.

### Phase 3 — Live E2E (fixtures cannot prove these)

Use existing harness (`createSeededWorkspace`, `createOrOpenProject`, `@agent`):

| Live scenario                            | Why live            |
| ---------------------------------------- | ------------------- |
| Working row + elapsed tick during a turn | Real stream / timer |
| Working → Idle (or Waiting) after settle | Real lifecycle      |
| Accordion → real draft/thread            | Seed path + UI      |

Cheap model via `.env`: `KATACODE_E2E_AGENT_PROVIDER` / `KATACODE_E2E_AGENT_MODEL`.

Keep Forced Failed, plan-ready, 30+ scroll, multi-project Waiting hint on **fixtures**.

**Exit:** AC 3 (timer) + transition confidence.

### Phase 4 — Close Verify

Fit-and-finish from Phase 1 notes → re-run fixture suite + live slices → environments regression → mark spec **Verified** → PR.

## Commands cheat sheet

```bash
# Fixture / playground browser suite
vp run --filter @kata-sh/code-web test --project browser -t "Sidebar v2"

# Existing smoke
vp run e2e --project desktop-dev --grep @sidebar

# Later live (Phase 3)
vp run e2e --project desktop-dev --grep '@sidebar|@agent'
```

## Related

- [Sidebar v2 spec](/specs/2026-07-14-sidebar-v2-hybrid-design.md)
- [E2E test catalog](/guides/e2e-test-catalog.md)
- [UAT evidence dir](../../uat-evidence/) (gitignored local Verify artifacts)
