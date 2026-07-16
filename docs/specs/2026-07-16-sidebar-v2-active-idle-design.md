---
type: Spec
title: "Sidebar v2: Active / Idle sections + dwell, Sleep, Pin"
description: "Replace four vertical attention tiers with Active/Idle sections, sub-state chips, configurable dwell idle timer, and Sleep/Pin context-menu controls — frontend-only follow-on to sidebar v2."
status: Approved
approved_at: 2026-07-16T17:29:00Z
tags: [web, sidebar, ux, orchestration]
timestamp: 2026-07-16T17:29:00Z
supersedes_list_structure: /specs/2026-07-14-sidebar-v2-hybrid-design.md
---

# Sidebar v2: Active / Idle sections + dwell, Sleep, Pin

## Status

**Approved** (2026-07-16). Maintainer-aligned follow-on to
[Sidebar v2 attention tiers](/specs/2026-07-14-sidebar-v2-hybrid-design.md).
This spec **supersedes the four-tier list structure** (Waiting / Working /
Blocked / Idle as separate vertical sections). Picker, accordion new-session,
meta row, Failed pill, and frontend-only hard boundary remain in force from
the parent spec.

## Goal

Reduce jarring vertical reshuffles when sessions leave Working:

1. **Two sections only** — **Active** and **Idle**.
2. **Sub-state on Active cards** — chip and/or tint for connecting, working,
   waiting, blocked (and optional quiet “done” during dwell).
3. **Dwell before Idle** — settled sessions stay Active for a configurable
   inactivity window (default **60 minutes**) measured as relative duration
   since last settled activity (`nowMs - lastActivityAt`), not absolute
   wall-clock rules.
4. **General settings** — enable/disable idle timer + duration (minutes).
5. **Sleep / Pin** — context-menu affordances that manually move sessions
   between Active and Idle (cognitive attention area). These remain relevant
   **even when the idle timer is disabled**.

Out of scope for this ship: improving live detection of Waiting/Blocked
shell flags (separate follow-up after Active/Idle UX is verified).

## Hard scope boundary

Same as parent: **sidebar presentation + client settings / UI state** only.
Do not touch environments/sandbox/BYOC contracts or services.

## Decisions (locked)

| Decision             | Value                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sections             | Active · Idle only                                                                                                                                                             |
| Attention sub-states | Never leave Active due to timer (waiting / working / connecting / blocked)                                                                                                     |
| Settled → Idle       | After dwell `T` when timer enabled; never auto when timer disabled                                                                                                             |
| Default `T`          | 60 minutes                                                                                                                                                                     |
| Settings             | Client: `sidebarIdleTimerEnabled` (default true), `sidebarIdleTimerMinutes` (default 60) under General                                                                         |
| Sleep                | Force section = Idle (manual). Always available.                                                                                                                               |
| Pin                  | Force section = Active (manual). Always available. Blocks auto-idle and Sleep while pinned (offer Unpin).                                                                      |
| Sleep while pinned   | Disabled / no-op until Unpin                                                                                                                                                   |
| Pin while Idle       | Moves to Active and stays Active until Unpin + (timer rules / Sleep)                                                                                                           |
| Sleep while Active   | Moves to Idle immediately; clear Sleep when attention sub-state returns or user Pins / opens and resumes activity (Build: clear forced-sleep on next non-idle shell sub-state) |
| Persistence          | Timer settings → `ClientSettings`. Pin/Sleep overrides → `uiStateStore` keyed by scoped thread id (like `threadLastVisitedAtById`)                                             |
| Pixel contract       | Keep v2 card language; replace four section headers with Active/Idle. Sub-state chip is additive chrome, not a return to old Sidebar.                                          |

### Idle timer semantics

- **Enabled:** settled + not pinned + not forced-sleep → Idle iff
  `nowMs - lastSettledActivityAt >= T`.
- **Disabled:** never auto-idle. Section membership is only:
  attention sub-state → Active; else Sleep → Idle; else Pin → Active;
  else → Active (settled stays Active).
- **lastSettledActivityAt:** prefer latest of turn `completedAt` /
  thread `updatedAt` when session is settled; attention states ignore dwell.
- Coming back from lunch: attention threads stay Active; settled past `T`
  correctly Idle. No “idle if before today” rules.

### Sleep / Pin (manual attention)

Sleep and Pin are **section overrides**, not archive:

- They exist to let the user curate the Active cognitive list.
- Independent of whether auto-dwell is on.
- Context menu labels: **Sleep**, **Pin** / **Unpin** (and keep existing
  rename / mark unread / copy / delete).
- Do not conflate with Archive.

### Sort within Active

Stable priority for sub-state ordering (not separate sections):

waiting → blocked → working/connecting → settled (dwell) / pinned-settled

Idle: existing slim rows; expand on click (unchanged density behavior).

## Acceptance criteria

1. Sidebar list renders at most two section headers: **Active** and **Idle**
   (omit empty). No Waiting / Working / Blocked section headers.
2. A settled thread remains under Active until dwell elapses (default 60m)
   when the idle timer is enabled, unless Sleep is used.
3. Threads in waiting / working / connecting / blocked sub-states never
   leave Active due to the idle timer.
4. When idle timer is **disabled**, settled threads stay Active unless the
   user chooses **Sleep**.
5. **Pin** keeps a thread in Active (and prevents Sleep / auto-idle until
   Unpin). Pin from Idle moves the thread to Active.
6. **Sleep** moves an unpinned Active thread to Idle immediately; Sleep is
   unavailable or no-op while pinned.
7. General settings expose idle-timer enable toggle and duration (minutes),
   defaulting to enabled + 60.
8. Fixture playground / Vitest browser scenarios cover Active+Idle grouping,
   dwell boundary, timer-disabled behavior, Pin, and Sleep.
9. Parent hard boundary held: no environments/sandbox/BYOC edits.
10. Maintainer visual check: Active/Idle + chips readable in dark playground
    and real app (AC 11 successor for this revision).

## Build handoff

### Phases

| Phase | Work                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Logic: `resolveThreadSection` (active/idle), `resolveThreadSubState`, dwell helper, pin/sleep overrides; unit tests. Client settings fields + defaults. |
| B     | UI: section headers Active/Idle; sub-state chip/tint on Active cards; wire `nowMs` + settings into grouping.                                            |
| C     | Context menu Sleep / Pin / Unpin; uiStateStore persistence; clear sleep on attention return.                                                            |
| D     | General settings controls; fixture catalog + playground scenarios; update `@sidebar` smoke if selectors change.                                         |

### Verification commands

```bash
vp check
vp run typecheck
vp run --filter @kata-sh/code-web test -- src/components/Sidebar.logic.test.ts
vp run --filter @kata-sh/code-web test:browser -- src/components/sidebar/SidebarV2.browser.tsx
# UAT
pnpm run dev
open http://localhost:5733/playground/sidebar
```

### Non-goals

- Live Waiting/Blocked shell-flag improvements.
- Inline Approve/Review.
- Changing archive/delete semantics.
- Server schema for pin/sleep.

## Related

- Parent: [Sidebar v2 attention tiers](/specs/2026-07-14-sidebar-v2-hybrid-design.md)
- UAT: [Sidebar v2 UAT — playground-first](/guides/sidebar-v2-uat-playground.md)
- Playground: `/playground/sidebar`
