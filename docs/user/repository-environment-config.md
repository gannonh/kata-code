---
type: Guide
title: "Repository environment configuration"
description: "Configure repository setup for Kata Code sandboxes with .kata/environment.json."
tags: [user, guide, sandbox]
---

# Repository environment configuration

Use `.kata/environment.json` to commit shared sandbox setup for a repository. Kata reads the file when it creates a sandbox.

Create the file at the repository root:

```text
.kata/environment.json
```

For a Vercel sandbox, Kata reads the file from the selected GitHub branch after Vercel clones it into `/vercel/sandbox`. Docker reads the same repository-relative path from the local repository it seeds into `/workspace`.

## Format

```json
{
  "install": "pnpm install",
  "start": "pnpm dev --host 0.0.0.0",
  "terminals": [
    {
      "name": "worker",
      "command": "pnpm worker"
    }
  ]
}
```

All fields are optional:

- `install`: a command that Kata runs synchronously in the repository root. Sandbox creation fails when it exits unsuccessfully.
- `start`: a long-running command that Kata launches as a detached process.
- `terminals`: named long-running commands that Kata launches as separate detached processes. Each entry needs a `name` and `command`.

The schema also reserves `build` and `snapshot` fields. Current setup execution uses `install`, `start`, and `terminals`. Vercel rejects a `build.dockerfile` setting because Vercel sandboxes cannot build Docker images.

The full schema is defined in [`packages/sandbox-contracts/src/environmentConfig.ts`](../../packages/sandbox-contracts/src/environmentConfig.ts).

## Precedence

Kata resolves each field separately:

1. `.kata/environment.json` from the repository
2. Saved repository setup in Kata Code Settings
3. The provider default

A repository file value wins only for its own field. For example, a file can define `install` while Kata uses a saved Settings value for `start`.

The Settings fields do not edit the repository file. They are per-user fallback values keyed to the repository identity. Repository environment variables and target runtime environment variables also live in Settings; keep secrets out of `.kata/environment.json`.

## Lifecycle

Kata reads the file during sandbox creation. Stopping and starting a persistent Vercel sandbox resumes its filesystem snapshot and does not rerun repository setup. Delete and recreate the sandbox after changing this file or the selected branch.

A missing file is valid. An invalid JSON file or invalid configuration fails creation with an error.

## Related settings

The Vercel deployment card identifies the selected repository and branch, then shows the saved setup fields that apply when this file omits a field. Docker uses the same precedence model with its local repository source.
