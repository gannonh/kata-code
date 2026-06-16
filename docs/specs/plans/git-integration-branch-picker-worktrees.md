---
type: Plan
title: "Git Integration: Branch Picker + Worktrees"
description: "Add git integration to let users start new threads from a specific branch, optionally creating a git worktree for isolated agent work."
tags: [plan]
timestamp: 2026-06-16T17:10:05Z
---

# Git Integration: Branch Picker + Worktrees

## Summary

Add git integration to let users start new threads from a specific branch, optionally creating a git worktree for isolated agent work.

## UX Flow

- **Left click** "+ New thread" → immediately creates a thread (current behavior, unchanged)
- **Right click** "+ New thread" → opens a context menu with git options:
  - List of local branches → clicking one creates a thread on that branch (uses project cwd)
  - Each branch has a "worktree" sub-option → creates a worktree, then creates thread with worktree as cwd
- When thread has a worktree, the agent session uses the worktree path as its cwd
- If git fails (not a repo), context menu shows "Not a git repository" disabled item

## Changes

### 1. `packages/contracts/src/git.ts` — CREATE

New Zod schemas and types:

- `gitListBranchesInputSchema` — `{ cwd: string }`
- `gitCreateWorktreeInputSchema` — `{ cwd: string, branch: string, path?: string }`
- `gitRemoveWorktreeInputSchema` — `{ cwd: string, path: string }`
- `gitBranchSchema` — `{ name: string, current: boolean }`
- Result types for each

### 2. `packages/contracts/src/ipc.ts` — MODIFY

- Add 3 IPC channels: `git:list-branches`, `git:create-worktree`, `git:remove-worktree`
- Add `git` namespace to `NativeApi` with `listBranches`, `createWorktree`, `removeWorktree`

### 3. `packages/contracts/src/index.ts` — MODIFY

- Add `export * from "./git"`

### 4. `apps/desktop/src/main.ts` — MODIFY

Add 3 IPC handlers + helper functions:

- `listGitBranches()` — runs `git branch --no-color`, parses output into `{ name, current }[]`
- `createGitWorktree()` — runs `git worktree add <path> <branch>`, defaults path to `../{repo}-worktrees/{branch}`
- `removeGitWorktree()` — runs `git worktree remove <path>`

Reuses existing `runTerminalCommand()`.

### 5. `apps/desktop/src/preload.ts` — MODIFY

Add `git` namespace with 3 `ipcRenderer.invoke` calls.

### 6. `apps/renderer/src/types.ts` — MODIFY

Add to `Thread`:

```
branch: string | null
worktreePath: string | null
```

### 7. `apps/renderer/src/persistenceSchema.ts` — MODIFY

- Add optional `branch`/`worktreePath` to persisted thread schema (`.nullable().optional()` for backwards compat)
- Add V3 schema, update union
- Update `hydrateThread` to default new fields to `null`
- Update `toPersistedState` to serialize new fields

### 8. `apps/renderer/src/store.ts` — MODIFY

- Update persisted state key to v3, keep v2 as legacy fallback

### 9. `apps/renderer/src/components/Sidebar.tsx` — MODIFY (main UI work)

- Keep existing left-click `handleNewThread` unchanged (immediate thread creation)
- Add `onContextMenu` handler to "+ New thread" buttons (both global and per-project)
- On right-click: fetch branches via `api.git.listBranches`, show a custom context menu
- Context menu items: branch names, each with a nested option to create with worktree
- Clicking a branch → creates thread with `branch` set, title = branch name
- Clicking "with worktree" → calls `api.git.createWorktree` first, then creates thread with `worktreePath`
- Show branch badge on thread list items
- If not a git repo, show "Not a git repository" as disabled menu item

Context menu component: a positioned `<div>` with `position: fixed` anchored to the click position, dismissed on click-outside or Escape. Follows the existing dropdown pattern from ChatView's model picker.

### 10. `apps/renderer/src/components/ChatView.tsx` — MODIFY

- Line 157: use `activeThread.worktreePath ?? activeProject.cwd` as session cwd
- Show branch/worktree badge in header bar

## Implementation Order

1. `packages/contracts/src/git.ts` (new schemas)
2. `packages/contracts/src/ipc.ts` + `index.ts` (wire up channels)
3. `apps/desktop/src/main.ts` (git command handlers)
4. `apps/desktop/src/preload.ts` (bridge methods)
5. `apps/renderer/src/types.ts` (Thread type update)
6. `apps/renderer/src/persistenceSchema.ts` + `store.ts` (persistence migration)
7. `apps/renderer/src/components/Sidebar.tsx` (branch picker UI)
8. `apps/renderer/src/components/ChatView.tsx` (worktree cwd + badge)

## Edge Cases

- **Not a git repo**: `git branch` fails → context menu shows "Not a git repository" disabled item
- **Branch has slashes**: `feature/foo` → worktree dir becomes `feature-foo`
- **Worktree exists**: git error surfaces to user via inline error message in context menu
- **No persistence breakage**: `.nullable().optional()` fields parse fine with old data

## Verification

1. `turbo build` — confirm contracts/desktop/renderer all compile
2. Launch app, add a project pointing to a git repo
3. Click "+ New thread" → verify branch list loads
4. Select a branch, click Start → thread created with branch in title
5. Enable worktree checkbox, pick branch, Start → verify worktree directory created on disk
6. Send a message in worktree thread → verify agent runs in worktree cwd
7. Add a non-git project → verify graceful error, can still create thread
