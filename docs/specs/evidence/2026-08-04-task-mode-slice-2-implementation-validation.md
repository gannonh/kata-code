---
type: Evidence
title: "Task mode Vertical Slice 2 Guided implementation validation"
description: "Automated validation and acceptance status for the Guided Implement task-route slice."
status: In progress
recommendation: "Implementation complete; provider-backed cumulative acceptance remains open"
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

`b3805832b` (`fix(task-workspace): harden guided implement recovery`)

The implementation is cumulative with the preceding Slice 2 commits listed in the child spec's
delivery record.

## Automated evidence

Focused server/provider/compiler tests:

```text
Test Files  4 passed (4)
Tests       98 passed (98)
```

Current-route browser tests:

```text
Test Files  17 passed (17)
Tests       241 passed (241)
```

Repository test suite:

```text
Test Files  528 passed | 2 skipped (530)
Tests       4354 passed | 11 skipped (4365)
```

Repository gates:

| Gate                   | Result | Notes                                                    |
| ---------------------- | ------ | -------------------------------------------------------- |
| `vp run typecheck`     | Pass   | Existing suggestions only                                |
| `vp check`             | Pass   | 0 errors, 47 existing warnings                           |
| `vp run test`          | Pass   | 528 files, 4,354 tests passed                            |
| `vp run release:smoke` | Pass   | Release smoke checks passed                              |
| `vp run check:okf`     | Pass   | OKF bundle validation passed after this record was added |

## Acceptance mapping

| Criterion                           | Implementation evidence                                                                    | Status                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| TM-S2-AC01 versioning and upgrade   | Append-only `guided@0.3.0`, compatibility upgrade, catalog parity tests                    | Implemented                                                 |
| TM-S2-AC02 start and bootstrap      | Worktree readiness, one occurrence/session, outbox recovery tests                          | Implemented                                                 |
| TM-S2-AC03 isolation                | Codex permission profile, shell environment filtering, OS-enforced check sandbox tests     | Implemented; provider-backed adversarial acceptance pending |
| TM-S2-AC04 approved context         | Exact Plan revision and bounded implementation context tests                               | Implemented                                                 |
| TM-S2-AC05 durable progress         | Typed bridge authorization, dependency and stale-revision tests                            | Implemented                                                 |
| TM-S2-AC06 checks                   | Pre-spawn HEAD evidence, bounded attempts, explicit recovery, indeterminate reconciliation | Implemented                                                 |
| TM-S2-AC07 checkpoints              | Waiting gate, failed-check rerun, continuation readiness, browser coverage                 | Implemented                                                 |
| TM-S2-AC08 amendments               | Provider proposal, review actions, structural invalidation, continuation tests             | Implemented                                                 |
| TM-S2-AC09 completion               | Server-observed branch, clean worktree, exact resulting commit validation                  | Implemented                                                 |
| TM-S2-AC10 recovery                 | Bootstrap, check, checkpoint, amendment, and completion recovery tests                     | Implemented                                                 |
| TM-S2-AC11 current surface          | Conversation-first Implement panel and hidden historical controls                          | Implemented                                                 |
| TM-S2-AC12 cumulative desktop proof | Updated form-driven scenario reaches the current Implement panel                           | Pending authenticated provider-backed completion path       |

## Provider-backed acceptance blocker

The local environment does not provide `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. The
authenticated desktop E2E cannot run to completion without those credentials. The repository keeps
the scenario under `e2e/tests/task-workspaces/slice-4.spec.ts`, and the current catalog assertion
pins new tasks to `guided@0.3.0`.

No provider-backed completion, checkpoint, amendment, restart, or resulting-commit claim is made
from the blocked run.
