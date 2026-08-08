# Specs

Specs for this project are GitHub Issues. This directory holds the roadmap pointer, the archive of
pre-migration spec documents, and explicitly retained non-spec registries.

## Read the roadmap

```bash
gh issue list --label kind:spec --state open            # all active specs
gh issue list --label status:approved --state open      # approved, ready to build
gh issue list --label status:implemented --state open   # built, awaiting verification
gh issue view <N>                                       # read a spec
gh sub-issue list <N>                                   # read an epic's phases
```

## Status model

| Label                | Meaning                                     |
| -------------------- | ------------------------------------------- |
| `status:draft`       | Being written or revised. Do not build.     |
| `status:approved`    | Approved by the maintainer. Ready to build. |
| `status:implemented` | Built and reported. Ready to verify.        |
| `status:verified`    | Acceptance evidence accepted.               |
| `status:blocked`     | Cannot proceed. See the issue body.         |

## Current Task roadmap

| Issue                                                 | Status                  | Scope                                         |
| ----------------------------------------------------- | ----------------------- | --------------------------------------------- |
| [#72](https://github.com/gannonh/kata-code/issues/72) | `status:approved`, epic | Task mode and Agent Runtime product roadmap   |
| [#73](https://github.com/gannonh/kata-code/issues/73) | `status:implemented`    | Guided planning                               |
| [#74](https://github.com/gannonh/kata-code/issues/74) | `status:implemented`    | Guided implementation                         |
| [#76](https://github.com/gannonh/kata-code/issues/76) | `status:approved`       | Conversation-plus-panel production shell      |
| [#80](https://github.com/gannonh/kata-code/issues/80) | `status:implemented`    | Task permissions choice for coding agent runs |
| [#75](https://github.com/gannonh/kata-code/issues/75) | `status:draft`          | Shared Agent Runtime and Guided delegation    |

The approved conversation-plus-panel shell (#76) precedes Agent Runtime convergence (#75).
Cumulative provider-backed Task acceptance remains tracked in [#64](https://github.com/gannonh/kata-code/issues/64).
The Plan approval regression is tracked and fixed through [#70](https://github.com/gannonh/kata-code/issues/70)
and [PR #71](https://github.com/gannonh/kata-code/pull/71).

## Writing and executing specs

Use the `plan-build-verify-github` skill. It publishes specs as issues, runs Build against approved
issues, and posts acceptance evidence back to the issue.

## Retained non-spec registries

- [`deferred-work.md`](./deferred-work.md) records deferred items pending reconciliation with
  existing GitHub issues.
- [`product-backlog.md`](./product-backlog.md) is retained for later backlog triage.

## Archive

Pre-migration spec files are preserved under [`archive/`](./archive/) with links to their issues when
applicable. Archived files are historical and are not maintained.
