# Own and resume one integration

Configure the future routine with one canonical coordinator checkout on one host, one active execution, the absolute canonical skill path, and its intended Build route. Apply only that configured route when creating issue labels, and verify it matches the executing agent. All integration runs must use that coordinator's Git common directory for ownership, even when editing an isolated worktree. Do not start an unattended run from a different clone or host; local locks do not coordinate different hosts.

Before creating an issue or worktree, atomically acquire the repository-wide lock. Resolve `coordinator_repo` from the routine or invocation, then execute:

```bash
git_common_dir="$(git -C "$coordinator_repo" rev-parse --path-format=absolute --git-common-dir)"
mkdir "$git_common_dir/kata-upstream.lock"
```

Success acquires the lock. If the directory already exists, inspect its owner and the durable run record. An active owner means exit without starting a second integration. Missing ownership metadata or uncertain liveness means `NEEDS_ACTION`; age alone does not authorize removing the lock. A crashed owner's lock can be recovered only after the owner is confirmed stopped and its work is reconciled.

Immediately record this invocation's host, owning task identity, and start time inside the lock directory only. The first post-lock operation is to load `$git_common_dir/kata-upstream-run.json` if it exists and reconcile its issue, branch/worktree, PR, and learning state against live records. Preserve its run identity, frozen target, and phase until that classification is complete. Acquiring the lock does not authorize replacing a retained run record.

Resume an unfinished matching run, including a merged run with pending learning. Initialize a new run record only after proving no pending run exists. If local metadata is missing or inconsistent, search the recorded branches and Linear/PR state before creating work; unresolved ownership is `NEEDS_ACTION`. Persist the classified run record before creating the issue branch or worktree. Update it by writing a sibling temporary file and atomically replacing the record. Keep these fields current:

- Run identity and owner, canonical coordinator path, exact `canonicalSkillPath`, and initial skill-content digest.
- Frozen Kata base, previous upstream pin, original root, target upstream SHA, and eventual candidate SHA.
- Linear issue ID and generated branch name, worktree path, PR URL, and current phase.
- Durable evidence destination, landed SHA, acceptance result, and learning status/content digest.

The skill digest manifest includes SKILL.md and its supporting resources, not only the entrypoint. Record paths relative to the canonical skill directory so a reference-only correction is visible at the next invocation.

Persist new identifiers immediately after each external operation. If a write returns an uncertain response, query its result before retrying. For the small gap between issue creation and recording its ID, search Linear by the exact target SHA and recorded run identity placed in the issue description. Reuse the matching issue. Never infer that an interrupted call created nothing.

Mirror the run identity, frozen target, branch/PR, and current phase on the owning Linear issue when integration mode authorizes those writes. Git history, remote PR state, and live Linear state settle disagreements with the local record. Do not overwrite a changed human-owned state from the saved phase.

On a deliberate stop, save evidence and the pending action, then release only the lock owned by this run. Retain the durable run record for the next occurrence. On success, record acceptance and learning completion before releasing the lock. A retry finding a merged PR must finish learning before considering `NO_CHANGE`. A `NO_CHANGE` exit also releases its owned lock and preserves the previous completed record; it does not invent a candidate or acceptance receipt.

These records belong to the Git common directory and Linear, not the tracked product tree. Rehearsals use a separate temporary coordinator and fictional issue records. Test duplicate acquisition and crash recovery there before enabling a routine. Do not install a new scheduler or distributed lock service as part of this skill.
