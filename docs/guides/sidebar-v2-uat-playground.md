---
type: Guide
title: "Sidebar v2 UAT — playground-first"
description: "Maintainer UAT and proof plan for attention-tier sidebar: fixture catalog → dev fixture route → Vitest browser assertions → live @sidebar/@agent E2E."
tags: [web, sidebar, ux, testing, uat, e2e]
timestamp: 2026-07-16T16:10:00Z
---

# Sidebar v2 UAT — playground-first

Companion to [Sidebar v2 attention tiers](/specs/2026-07-14-sidebar-v2-hybrid-design.md).
Pixel reference remains [`c-attention-session.html`](../comps/sidebar-v2-prototypes/c-attention-session.html);
**UAT and automated proof start from seeded fixtures**, not hand-built demo repos.

## Principle

One fixture catalog drives:

1. Maintainer UAT (dev fixture route — normal browser window)
2. Vitest browser assertions (AC 2–6, 8)
3. Later live `@sidebar` / `@agent` E2E (only what fixtures cannot prove)

Do not build a separate “demo farm” and then rebuild the same seeds for tests.

## What’s already built vs what this plan proves

| Layer                                                                      | Status                          |
| -------------------------------------------------------------------------- | ------------------------------- |
| Product UI (tiers, picker, Idle expand, accordion, Failed→Blocked, timers) | **Built** on `sidebar-redesign` |
| Unit logic (`Sidebar.logic.ts`)                                            | **Proven**                      |
| `@sidebar` smoke (chrome + accordion)                                      | **Proven**                      |
| Populated-state fixtures + AC 11 visual sign-off                           | **This plan**                   |
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

### Phase 1 — Dev fixture route (maintainer UAT)

**Route (DEV only):** [`/playground/sidebar`](http://localhost:5733/playground/sidebar)

- Page: `apps/web/src/components/sidebar/SidebarV2PlaygroundPage.tsx`
- Seeds the real Zustand shell via `syncServerShellSnapshot` from `sidebarV2Scenarios.ts`
- Forces **dark** mode; full-size browser window (your Chrome/Safari — not Vitest)
- Scenario switcher (top-right) walks all fixture ids

```bash
# Terminal 1 — normal web + server (default port 5733)
pnpm run dev

# Then open in your browser:
open http://localhost:5733/playground/sidebar

# Pixel reference in another tab:
docs/comps/sidebar-v2-prototypes/serve.sh
# → http://127.0.0.1:8765/c-attention-session.html
```

Production builds redirect `/playground/sidebar` → `/`. Root auth/WS bootstrap is skipped for `/playground/*` in DEV.

**Do not use Vitest `--ui` or headed browser tests for fit-and-finish.** Those surfaces are the test runner (scaled iframe / dashboard chrome), not the product.

**Exit:** AC 11 visual sign-off on **populated** states (not empty chrome).

### Phase 2 — Vitest browser assertions (CI)

File: `apps/web/src/components/sidebar/SidebarV2.browser.tsx`

Same fixture catalog; headless Chromium asserts tier headers / row contracts. Not for interactive UAT.

```bash
vp run --filter @kata-sh/code-web test:browser -- src/components/sidebar/SidebarV2.browser.tsx
```

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

## Framework roles (not a migration)

| Surface                          | Purpose                                    |
| -------------------------------- | ------------------------------------------ |
| `/playground/sidebar` (DEV)      | Maintainer UAT, fit-and-finish             |
| Vitest browser (`*.browser.tsx`) | Component assertions in real Chromium (CI) |
| Playwright `e2e/`                | Full-stack web/Electron E2E                |
| C prototype HTML                 | Pixel / motion reference                   |

Storybook is unnecessary here: the sidebar is store/router/WS-wired; a fixture route reuses the same catalog without a second harness.

## Commands cheat sheet

```bash
# Interactive UAT (your browser, full window, dark)
pnpm run dev
open http://localhost:5733/playground/sidebar

# Automated fixture assertions (headless)
vp run --filter @kata-sh/code-web test:browser -- src/components/sidebar/SidebarV2.browser.tsx

# Existing smoke
vp run e2e --project desktop-dev --grep @sidebar

# Later live (Phase 3)
vp run e2e --project desktop-dev --grep '@sidebar|@agent'
```

## Related

- [Sidebar v2 spec](/specs/2026-07-14-sidebar-v2-hybrid-design.md)
- [E2E test catalog](/guides/e2e-test-catalog.md)
- [UAT evidence dir](../../uat-evidence/) (gitignored local Verify artifacts)
