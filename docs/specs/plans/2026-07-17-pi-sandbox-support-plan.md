# Pi Sandbox Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate Pi end-to-end in Docker and Vercel sandboxes, fix what validation surfaces, then remove Pi from the composer's sandbox "Coming Soon" dim set.

**Architecture:** Pi is an in-process SDK provider — the in-sandbox `katacode serve` loads `@earendil-works/pi-coding-agent` directly. Both sandbox paths already install the SDK and seed `~/.pi/agent` credentials; the only hard gate is a client-side hardcoded set in `ChatComposer.tsx`. The plan extracts that set into a testable pure helper, runs the manual validation matrix from the spec, fixes anything surfaced, then flips the helper (test-first) to un-gate Pi.

**Tech Stack:** TypeScript, React (apps/web), Effect (apps/server), vite-plus test (`vp test`), Docker + Vercel Sandbox drivers.

**Spec:** [`docs/specs/2026-07-17-pi-sandbox-support-design.md`](../2026-07-17-pi-sandbox-support-design.md)

## Global Constraints

- `vp check` and `vp run typecheck` must pass before any task is considered complete.
- Conventional Commits: `<type>(<scope>): <summary>`; atomic commits; commit after each task.
- Do NOT commit the un-gate (removing `"pi"` from the dim set) until Tasks 2–4 validation passes (spec Phase 1/3 ordering).
- Manual UAT evidence (screenshots) goes to `e2e/verify-evidence/` with the `pi-sandbox-` filename prefix; the build report lives at `docs/specs/2026-07-17-pi-sandbox-support-build-report.md`.
- The Vercel sandbox runs the **published** kata CLI (`@kata-sh/code-cli`, optionally pinned via `KATACODE_SANDBOX_CLI_TAG=nightly`). Host-side fixes (credential seeding, bootstrap script) take effect immediately; fixes to code that runs **inside** the sandbox serve require a nightly CLI publish. Flag this to the user before attempting any in-sandbox-serve fix.
- Vercel bootstrap pins Pi to `PI_SDK_PIN = "0.80.2"` (`packages/sandbox-vercel/src/bootstrap.ts`). If validation shows the pin is the blocker, STOP and report to the user — the fix (publish a kata CLI built against the current Pi API, remove the pin) becomes a prerequisite decision per the spec, not a silent side quest.

---

### Task 1: Extract the sandbox coming-soon dim set into a testable helper

Behavior-preserving refactor: move the hardcoded `sandboxUnsupportedKinds` set out of `ChatComposer.tsx` into a pure function in `providerInstances.ts` with unit tests. Pi stays gated in this task.

**Files:**

- Modify: `apps/web/src/providerInstances.ts` (append after `ProviderInstanceEntry` helpers)
- Modify: `apps/web/src/components/chat/ChatComposer.tsx:665-679` (the `comingSoonInstanceIds` useMemo)
- Test: `apps/web/src/providerInstances.test.ts`

**Interfaces:**

- Consumes: `ProviderInstanceEntry` (existing, `apps/web/src/providerInstances.ts:33`), `deriveProviderInstanceEntries(providers: ReadonlyArray<ServerProvider>): ProviderInstanceEntry[]` (existing).
- Produces: `deriveSandboxComingSoonInstanceIds(entries: ReadonlyArray<ProviderInstanceEntry>): ReadonlySet<ProviderInstanceId>` — Task 6 modifies this function's kind set and its tests.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/providerInstances.test.ts` (the `provider()` fixture already exists at the top of the file; add `deriveSandboxComingSoonInstanceIds` to the existing import from `./providerInstances`):

```ts
describe("deriveSandboxComingSoonInstanceIds", () => {
  it("dims opencode, cursor, and pi instances but not codex or claude", () => {
    const entries = deriveProviderInstanceEntries([
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: "claudeAgent" }),
      provider({ provider: ProviderDriverKind.make("opencode"), instanceId: "opencode" }),
      provider({ provider: ProviderDriverKind.make("cursor"), instanceId: "cursor" }),
      provider({ provider: ProviderDriverKind.make("pi"), instanceId: "pi" }),
      provider({ provider: ProviderDriverKind.make("pi"), instanceId: "pi_custom" }),
    ]);

    const dimmed = deriveSandboxComingSoonInstanceIds(entries);

    expect([...dimmed].sort()).toEqual(["cursor", "opencode", "pi", "pi_custom"]);
  });

  it("returns an empty set when no dimmed-kind instances are configured", () => {
    const entries = deriveProviderInstanceEntries([
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
    ]);

    expect(deriveSandboxComingSoonInstanceIds(entries).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test apps/web/src/providerInstances.test.ts`
Expected: FAIL — `deriveSandboxComingSoonInstanceIds` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `apps/web/src/providerInstances.ts`:

```ts
/**
 * Provider driver kinds dimmed with a "Coming soon to sandboxes" tooltip when
 * the active thread is on a sandbox environment. These providers are not yet
 * validated end-to-end in sandboxes.
 */
const SANDBOX_COMING_SOON_KINDS: ReadonlySet<ProviderDriverKind> = new Set([
  ProviderDriverKind.make("opencode"),
  ProviderDriverKind.make("cursor"),
  ProviderDriverKind.make("pi"),
]);

/** Instance ids to dim in the model picker for sandbox environments. */
export function deriveSandboxComingSoonInstanceIds(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ReadonlySet<ProviderInstanceId> {
  const dimmed = new Set<ProviderInstanceId>();
  for (const entry of entries) {
    if (SANDBOX_COMING_SOON_KINDS.has(entry.driverKind)) {
      dimmed.add(entry.instanceId);
    }
  }
  return dimmed;
}
```

In `apps/web/src/components/chat/ChatComposer.tsx`, replace the existing useMemo body (currently at lines 665–679):

```ts
// In sandbox environments, dim providers that aren't validated end-to-end
// in sandboxes yet with a "Coming Soon" tooltip.
const comingSoonInstanceIds = useMemo<ReadonlySet<ProviderInstanceId> | undefined>(() => {
  if (!props.isSandboxEnvironment) return undefined;
  return deriveSandboxComingSoonInstanceIds(providerInstanceEntries);
}, [props.isSandboxEnvironment, providerInstanceEntries]);
```

Add `deriveSandboxComingSoonInstanceIds` to the existing import from `../../providerInstances` in `ChatComposer.tsx` (the import block at ~line 104 already pulls `deriveProviderInstanceEntries` and `sortProviderInstanceEntries` from there).

- [ ] **Step 4: Run tests and typecheck**

Run: `vp test apps/web/src/providerInstances.test.ts`
Expected: PASS (all tests, including pre-existing ones).

Run: `vp run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/providerInstances.ts apps/web/src/providerInstances.test.ts apps/web/src/components/chat/ChatComposer.tsx
git commit -m "refactor(web): extract sandbox coming-soon dim set into testable helper"
```

---

### Task 2: Manual UAT — Pi in a Docker sandbox

Run the spec's Phase 1 validation matrix against a local Docker sandbox. This task requires host Pi credentials (`~/.pi/agent/auth.json` present) and Docker running.

**Files:**

- Temporary (NOT committed): `apps/web/src/providerInstances.ts` — local gate bypass
- Create: `docs/specs/2026-07-17-pi-sandbox-support-build-report.md` (started here, extended by Tasks 3–4)
- Create: `e2e/verify-evidence/pi-sandbox-docker-*.png` (screenshots)

**Interfaces:**

- Consumes: `SANDBOX_COMING_SOON_KINDS` from Task 1 (the bypass edit target).
- Produces: Docker rows of the validation matrix in the build report; a list of surfaced defects for Task 5.

- [ ] **Step 1: Apply the temporary local gate bypass (do not commit)**

In `apps/web/src/providerInstances.ts`, remove the `ProviderDriverKind.make("pi"),` line from `SANDBOX_COMING_SOON_KINDS`. Verify with `git diff --stat` that only this file is dirty. This edit is reverted in Step 5.

- [ ] **Step 2: Provision a Docker sandbox**

Precondition: `ls ~/.pi/agent/auth.json` exists; `docker info` succeeds; no other dev server running.

```bash
pnpm run dev
```

Open `http://localhost:5733`. In Settings → Environments, add (or reuse) a Docker sandbox environment and start it. Wait until the environment shows connected.

- [ ] **Step 3: Run the validation matrix**

Create a new thread on the sandbox environment, then verify each row. Capture a screenshot per row into `e2e/verify-evidence/` with the listed filename:

| #   | Check                                                                                                                                                                      | Evidence file                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | Pi is selectable in the composer model picker (no dim, no tooltip)                                                                                                         | `pi-sandbox-docker-01-picker.png`    |
| 2   | Pi shows authenticated; runtime model discovery lists models from the seeded auth                                                                                          | `pi-sandbox-docker-02-models.png`    |
| 3   | A Pi turn streams to completion (assistant text + reasoning deltas). Prompt: "List the files in the workspace root, then summarize the repo in two sentences."             | `pi-sandbox-docker-03-stream.png`    |
| 4   | Tool calls execute against `/workspace` (the prompt above forces a file listing tool call)                                                                                 | `pi-sandbox-docker-04-tools.png`     |
| 5   | Interrupt/stop works mid-turn: send a long prompt ("Write a detailed 2000-word architecture overview of this repo"), click Stop mid-stream, composer returns to Send state | `pi-sandbox-docker-05-interrupt.png` |
| 6   | Thread resume: navigate away from the thread, reopen it, prior turns render, and a follow-up turn streams                                                                  | `pi-sandbox-docker-06-resume.png`    |

- [ ] **Step 4: Record results in the build report**

Create `docs/specs/2026-07-17-pi-sandbox-support-build-report.md`:

```markdown
---
type: Report
title: Pi sandbox support — build report
description: Validation evidence and fix log for Pi in Docker and Vercel sandboxes.
---

# Pi sandbox support — build report

Spec: [Pi provider support in sandbox environments](./2026-07-17-pi-sandbox-support-design.md)

## Docker sandbox validation (YYYY-MM-DD)

| #   | Check                           | Result    | Evidence                                                                |
| --- | ------------------------------- | --------- | ----------------------------------------------------------------------- |
| 1   | Pi selectable in picker         | PASS/FAIL | [screenshot](../../e2e/verify-evidence/pi-sandbox-docker-01-picker.png) |
| 2   | Authenticated + model discovery | PASS/FAIL | ...                                                                     |
| 3   | Turn streams to completion      | PASS/FAIL | ...                                                                     |
| 4   | Tool calls in /workspace        | PASS/FAIL | ...                                                                     |
| 5   | Interrupt/stop mid-turn         | PASS/FAIL | ...                                                                     |
| 6   | Thread resume                   | PASS/FAIL | ...                                                                     |

### Defects surfaced

(one bullet per defect with exact error text / log excerpt, or "none")
```

Fill every row with the actual PASS/FAIL and evidence links. If a row fails, record the exact error (UI error text, `docker logs <container>` excerpt, or provider status payload) under "Defects surfaced" — Task 5 consumes this list. Do not mark a failing row PASS.

- [ ] **Step 5: Revert the bypass and commit the evidence**

```bash
git checkout -- apps/web/src/providerInstances.ts
git add docs/specs/2026-07-17-pi-sandbox-support-build-report.md e2e/verify-evidence/pi-sandbox-docker-*.png
git commit -m "docs(specs): record Docker sandbox Pi validation evidence"
```

---

### Task 3: Manual UAT — Pi in a Vercel sandbox

Same matrix against a Vercel sandbox. Requires a configured Vercel sandbox provider instance (token/team/project in Settings) and host Pi credentials.

**Files:**

- Temporary (NOT committed): `apps/web/src/providerInstances.ts` — same bypass as Task 2 Step 1
- Modify: `docs/specs/2026-07-17-pi-sandbox-support-build-report.md`
- Create: `e2e/verify-evidence/pi-sandbox-vercel-*.png`

**Interfaces:**

- Consumes: build report from Task 2.
- Produces: Vercel rows of the validation matrix; surfaced defects for Task 5.

- [ ] **Step 1: Apply the temporary local gate bypass (do not commit)**

Same edit as Task 2 Step 1: remove `ProviderDriverKind.make("pi"),` from `SANDBOX_COMING_SOON_KINDS` in `apps/web/src/providerInstances.ts`.

- [ ] **Step 2: Provision a Vercel sandbox**

With `pnpm run dev` running and the Vercel deployment target configured in Settings → Environments, start a Vercel sandbox environment and wait for connected state. Note: provisioning includes the npm bootstrap (installs Pi pinned at `PI_SDK_PIN = 0.80.2`) and can take several minutes.

If the sandbox never becomes ready, capture `/tmp/katacode-serve.log` from the sandbox (via the environment terminal) before disposing — a module-load crash here is a candidate `PI_SDK_PIN` blocker (see Global Constraints: STOP and report).

- [ ] **Step 3: Run the validation matrix**

Identical six rows to Task 2 Step 3, with evidence files named `pi-sandbox-vercel-01-picker.png` … `pi-sandbox-vercel-06-resume.png`.

- [ ] **Step 4: Record results in the build report**

Append a `## Vercel sandbox validation (YYYY-MM-DD)` section to `docs/specs/2026-07-17-pi-sandbox-support-build-report.md` with the same table shape as Task 2 Step 4 and a "Defects surfaced" list. Same fail-loud rule: exact errors, no optimistic PASS.

- [ ] **Step 5: Revert the bypass and commit the evidence**

```bash
git checkout -- apps/web/src/providerInstances.ts
git add docs/specs/2026-07-17-pi-sandbox-support-build-report.md e2e/verify-evidence/pi-sandbox-vercel-*.png
git commit -m "docs(specs): record Vercel sandbox Pi validation evidence"
```

---

### Task 4: Manual UAT — degraded path (no host Pi credentials)

Spec AC-4: with no host Pi credentials, Pi shows unauthenticated in the sandbox without blocking the provider probe or other providers. One sandbox kind suffices (use Docker — faster provision).

**Files:**

- Temporary (NOT committed): `apps/web/src/providerInstances.ts` — same bypass
- Modify: `docs/specs/2026-07-17-pi-sandbox-support-build-report.md`
- Create: `e2e/verify-evidence/pi-sandbox-degraded-01-unauthenticated.png`

**Interfaces:**

- Consumes: Docker sandbox flow from Task 2.
- Produces: degraded-path row in the build report.

- [ ] **Step 1: Hide host Pi credentials and apply the bypass**

```bash
mv ~/.pi/agent/auth.json ~/.pi/agent/auth.json.uat-bak
```

Apply the same gate bypass as Task 2 Step 1.

- [ ] **Step 2: Provision a fresh Docker sandbox and verify**

Start a NEW Docker sandbox (a reused one may have previously-seeded credentials). Verify, capturing `pi-sandbox-degraded-01-unauthenticated.png`:

1. The provider list loads within the normal window — the Pi probe does not hang the provider status refresh (other providers report status normally).
2. Pi shows as unauthenticated (not crashed, no error toast).
3. Codex and Claude remain selectable and functional (send one short Codex or Claude turn).

- [ ] **Step 3: Restore credentials, record, commit**

```bash
mv ~/.pi/agent/auth.json.uat-bak ~/.pi/agent/auth.json
git checkout -- apps/web/src/providerInstances.ts
```

Append a `## Degraded path — no host Pi credentials (YYYY-MM-DD)` section to the build report with the three checks, PASS/FAIL, and the evidence link. Then:

```bash
git add docs/specs/2026-07-17-pi-sandbox-support-build-report.md e2e/verify-evidence/pi-sandbox-degraded-*.png
git commit -m "docs(specs): record degraded-path Pi sandbox validation evidence"
```

---

### Task 5: Fix defects surfaced by validation (decision gate)

This task only runs if Tasks 2–4 recorded defects. If all matrix rows passed, check this task off and continue to Task 6.

**Files:**

- Candidates (only touch what a defect implicates):
  - `apps/server/src/sandbox/credentialSeed.ts` + `credentialSeed.test.ts` — seeding/sanitization gaps (`sanitizePiSettings` currently strips only `packages`)
  - `packages/sandbox-vercel/src/bootstrap.ts` — install list / pin (see STOP rule below)
  - `Dockerfile` — installed Pi package
- Modify: `docs/specs/2026-07-17-pi-sandbox-support-build-report.md` (fix log)

**Interfaces:**

- Consumes: "Defects surfaced" lists from Tasks 2–4.
- Produces: fixed matrix rows (re-validated), unit-tested fixes.

- [ ] **Step 1: Triage each defect**

For each defect, use the systematic-debugging skill (`.agents/skills/systematic-debugging/SKILL.md`): reproduce, locate root cause, then fix. Decision rules:

- Root cause is host-side (credential seeding, bootstrap script, Docker image): fix it here, TDD-style — failing unit test in the co-located `*.test.ts` first, then minimal fix, then pass.
- Root cause is inside the in-sandbox serve (Pi adapter/driver code running in the container): STOP and report to the user — the fix needs a nightly CLI publish to reach sandboxes (see Global Constraints).
- Root cause is the `PI_SDK_PIN` (0.80.2 cannot read newer-host-written auth/settings, or the pinned build itself fails): STOP and report to the user per the spec's Phase 2 rule.

- [ ] **Step 2: Re-run the affected matrix rows**

After each fix, repeat only the failed rows from the affected task (2, 3, or 4) with a fresh sandbox and update the build report row from FAIL to PASS with new evidence. Append a `## Fix log` section: one entry per fix (defect → root cause → fix commit → re-validation evidence).

- [ ] **Step 3: Verify and commit each fix atomically**

Per fix:

```bash
vp check && vp run typecheck
git add <fix files + tests>
git commit -m "fix(sandbox): <root cause summary>"
```

Then commit the build report update separately:

```bash
git add docs/specs/2026-07-17-pi-sandbox-support-build-report.md e2e/verify-evidence/pi-sandbox-*.png
git commit -m "docs(specs): record Pi sandbox fix log and re-validation evidence"
```

---

### Task 6: Un-gate Pi (test-first)

Only after Tasks 2–4 report all-PASS (post-fixes). Flip the helper from Task 1.

**Files:**

- Modify: `apps/web/src/providerInstances.ts` (`SANDBOX_COMING_SOON_KINDS`)
- Test: `apps/web/src/providerInstances.test.ts`

**Interfaces:**

- Consumes: `deriveSandboxComingSoonInstanceIds` and its tests from Task 1.
- Produces: Pi selectable in sandbox environments (spec AC-1).

- [ ] **Step 1: Update the test to expect Pi un-gated**

In `apps/web/src/providerInstances.test.ts`, edit the first `deriveSandboxComingSoonInstanceIds` test from Task 1:

- Rename it to `"dims opencode and cursor instances but not pi, codex, or claude"`.
- Change the assertion to:

```ts
expect([...dimmed].sort()).toEqual(["cursor", "opencode"]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test apps/web/src/providerInstances.test.ts`
Expected: FAIL — set still contains `pi` and `pi_custom`.

- [ ] **Step 3: Remove Pi from the kind set**

In `apps/web/src/providerInstances.ts`, delete the `ProviderDriverKind.make("pi"),` line from `SANDBOX_COMING_SOON_KINDS` and update its docstring to name only OpenCode and Cursor:

```ts
/**
 * Provider driver kinds dimmed with a "Coming soon to sandboxes" tooltip when
 * the active thread is on a sandbox environment. OpenCode and Cursor are not
 * yet validated end-to-end in sandboxes; Pi was validated and un-gated (see
 * docs/specs/2026-07-17-pi-sandbox-support-design.md).
 */
const SANDBOX_COMING_SOON_KINDS: ReadonlySet<ProviderDriverKind> = new Set([
  ProviderDriverKind.make("opencode"),
  ProviderDriverKind.make("cursor"),
]);
```

- [ ] **Step 4: Run tests and full gates**

Run: `vp test apps/web/src/providerInstances.test.ts`
Expected: PASS.

Run: `vp check && vp run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/providerInstances.ts apps/web/src/providerInstances.test.ts
git commit -m "feat(web): enable Pi provider in sandbox environments"
```

---

### Task 7: Documentation, deferred work, and closeout

**Files:**

- Modify: `docs/specs/2026-07-17-pi-sandbox-support-design.md` (status)
- Modify: `docs/specs/index.md` (Pi sandbox row)
- Modify: `docs/specs/log.md` (entry)
- Create: GitHub issue — Cursor tooltip deferral

**Interfaces:**

- Consumes: all-PASS build report, un-gate commit from Task 6.
- Produces: closed-out spec; tracked Cursor follow-up.

- [ ] **Step 1: File the Cursor tooltip deferred-work issue**

```bash
gh issue create \
  --title "Cursor sandbox tooltip is inaccurate ('not enabled')" \
  --label deferred \
  --body "## Summary
The composer dims Cursor in sandbox environments with an inaccurate tooltip. Cursor remains sandbox-unsupported, but the copy should say 'Coming soon to sandboxes' (or the accurate reason), not 'not enabled'.

## Phase
Planning

## Reason for Deferral
Out of scope for the Pi sandbox support spec (docs/specs/2026-07-17-pi-sandbox-support-design.md, Non-goals).

## Context and Links
- Dim set: apps/web/src/providerInstances.ts (SANDBOX_COMING_SOON_KINDS)
- Tooltip copy: apps/web/src/components/chat/ModelPickerContent.tsx (~line 548)

## Done When
Cursor's sandbox tooltip copy accurately describes why it is disabled."
```

- [ ] **Step 2: Update spec status and index**

- In `docs/specs/2026-07-17-pi-sandbox-support-design.md`: frontmatter `status: Draft` → `status: Implemented`, and the `## Status` body line → `Implemented — see [build report](./2026-07-17-pi-sandbox-support-build-report.md).`
- In `docs/specs/index.md`: update the "Pi provider support in sandboxes" row from **Draft** to **Implemented**, linking the build report.
- Append a dated entry to `docs/specs/log.md` summarizing: validated Docker + Vercel + degraded path, fixes (if any), un-gate commit.

- [ ] **Step 3: Final verification**

Run: `vp check && vp run typecheck && vp run test`
Expected: all PASS. If anything fails, fix before committing — do not close out on red.

Confirm `git status` shows only the doc changes staged, and that the Task 2–4 temporary bypass is not present: `grep -n 'make("pi")' apps/web/src/providerInstances.ts` returns nothing.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/2026-07-17-pi-sandbox-support-design.md docs/specs/index.md docs/specs/log.md
git commit -m "docs(specs): mark Pi sandbox support implemented"
```
