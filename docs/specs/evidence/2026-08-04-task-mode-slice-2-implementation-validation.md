---
type: Evidence
title: "Task mode Vertical Slice 2 Guided implementation validation"
description: "Automated validation and acceptance status for the Guided Implement task-route slice."
status: In progress
recommendation: "Implementation complete; cumulative provider acceptance tracked in issue #64"
tags: [evidence, task-mode, guided, implementation, recovery, task-workspaces]
timestamp: 2026-08-04T14:10:00Z
parent: /specs/2026-08-03-task-mode-slice-2-guided-implementation-plan.md
---

# Task mode Vertical Slice 2 Guided implementation validation

## Scope

This record covers the implementation boundary from an approved Guided Plan through durable,
write-enabled Implement state. Verify, Done, delivery, and provider-backed acceptance remain
outside this record.

## Product SHA under test

`8994b99d3` (`fix(task-workspace): reconcile terminal-first completion`), with the bounded provider
E2E boundary in `84801e995` (`test(e2e): bound guided provider coverage`).

The implementation is cumulative with the preceding Slice 2 commits listed in the child spec's
delivery record.

## Automated evidence

Focused completion-settlement service test:

```text
Test Files  1 passed (1)
Tests       54 passed (54)
```

The regression covers both durable orderings: proposal before terminal settlement and terminal
evidence before proposal persistence.

Current-route browser tests:

```text
Test Files  17 passed (17)
Tests       241 passed (241)
```

Repository test suite:

```text
Test Files  527 passed | 1 failed | 2 skipped (530)
Tests       4356 passed | 1 failed | 11 skipped (4368)
```

The remaining full-suite failure is the unrelated, load-sensitive Git timeout tracked in
[#65](https://github.com/gannonh/kata-code/issues/65). Its complete focused file rerun passed 57/57.
The transient server test from the first full run also passed 98/98 when rerun directly.

Repository gates:

| Gate                   | Result  | Notes                                                                 |
| ---------------------- | ------- | --------------------------------------------------------------------- |
| `vp run typecheck`     | Pass    | Existing suggestions only                                             |
| `vp check`             | Pass    | 0 errors, 48 warnings                                                 |
| `vp run test`          | Blocked | 4,356 tests pass; unrelated load-sensitive Git timeout tracked in #65 |
| `vp run release:smoke` | Pass    | Release smoke checks passed                                           |
| `vp run check:okf`     | Pass    | OKF bundle validation passed after this record was updated            |

## Acceptance mapping

| Criterion                           | Implementation evidence                                                                    | Status                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| TM-S2-AC01 versioning and upgrade   | Append-only `guided@0.3.0`, compatibility upgrade, catalog parity tests                    | Implemented                                     |
| TM-S2-AC02 start and bootstrap      | Worktree readiness, one occurrence/session, outbox recovery tests                          | Implemented                                     |
| TM-S2-AC03 isolation                | Codex permission profile, shell environment filtering, OS-enforced check sandbox tests     | Implemented; provider acceptance tracked in #64 |
| TM-S2-AC04 approved context         | Exact Plan revision and bounded implementation context tests                               | Implemented                                     |
| TM-S2-AC05 durable progress         | Typed bridge authorization, dependency and stale-revision tests                            | Implemented                                     |
| TM-S2-AC06 checks                   | Pre-spawn HEAD evidence, bounded attempts, explicit recovery, indeterminate reconciliation | Implemented                                     |
| TM-S2-AC07 checkpoints              | Waiting gate, failed-check rerun, continuation readiness, browser coverage                 | Implemented                                     |
| TM-S2-AC08 amendments               | Provider proposal, review actions, structural invalidation, continuation tests             | Implemented                                     |
| TM-S2-AC09 completion               | Exact resulting-commit validation plus both durable terminal/proposal orderings            | Implemented                                     |
| TM-S2-AC10 recovery                 | Bootstrap, check, checkpoint, amendment, and completion recovery tests                     | Implemented                                     |
| TM-S2-AC11 current surface          | Conversation-first Implement panel and hidden historical controls                          | Implemented                                     |
| TM-S2-AC12 cumulative desktop proof | Authenticated form-driven scenario reaches active Implement in 1.7 minutes                 | Remaining cumulative acceptance tracked in #64  |

## Desktop E2E result

The bounded authenticated path was executed directly:

```bash
vp run e2e --project desktop-dev --grep 'Guided approved Plan'
```

```text
4 passed in 1.7 minutes
```

The real Codex and Clerk path creates a new `guided@0.3.0` task through the form, completes the
conversation-first planning stages, approves the Plan, and reaches the active Implement panel. It
uses the repository's standard 180-second agent-test ceiling.

A separate bounded completion experiment reached an accepted `task_implementation_complete`
proposal and rendered the provider's final response, but Codex kept the provider turn open beyond
the ceiling. The blocking E2E does not extend its timeout or steer the provider repeatedly.
Deterministic service and browser tests cover settlement and the resulting-commit projection. The
remaining provider-backed checkpoint, amendment, restart, adversarial isolation, and exact-commit
acceptance is tracked in [#64](https://github.com/gannonh/kata-code/issues/64).
