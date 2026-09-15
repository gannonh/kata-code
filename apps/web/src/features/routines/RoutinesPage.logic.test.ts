import { describe, expect, it } from "vite-plus/test";
import type { Routine, RoutineDraft, ServerProvider, VcsRef } from "@kata-sh/code-contracts";
import { ModelSelection, ProjectId, ProviderInstanceId } from "@kata-sh/code-contracts";
import * as Schema from "effect/Schema";

import {
  canSaveRoutineDraft,
  DELETE_ROUTINE_MESSAGE,
  DISCARD_UNSAVED_ROUTINE_MESSAGE,
  enabledProviders,
  firstEnabledProviderModel,
  isRoutineDraftDirty,
  keepDeletedRoutineInEditor,
  libraryRoutinesAfterChange,
  preferredWorktreeBaseBranch,
  ROUTINE_CANCEL_HINT,
  ROUTINE_CONTROL_CLASS,
  ROUTINE_EDITOR_FIELDS_CLASS,
  ROUTINE_PERMISSION_MODE_LABELS,
  ROUTINE_WHEN_TO_RUN_ACTIONS_CLASS,
  routinesLibraryEmptyKind,
  worktreeBaseExists,
} from "./RoutinesPage.logic";

const decodeModelSelection = Schema.decodeUnknownSync(ModelSelection);

function draft(patch: Partial<RoutineDraft> = {}): RoutineDraft {
  return {
    name: "",
    instruction: "",
    projectId: ProjectId.make("project-1"),
    modelSelection: decodeModelSelection({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    }),
    runtimeMode: "approval-required",
    workspace: { kind: "shared", directory: "/tmp/project" },
    trigger: { kind: "daily", time: "09:00", timezone: "UTC" },
    ...patch,
  };
}

function ref(name: string, flags: Partial<VcsRef> = {}): VcsRef {
  return {
    name,
    current: false,
    isDefault: false,
    isRemote: false,
    worktreePath: null,
    ...flags,
  };
}

function provider(input: {
  readonly instanceId: string;
  readonly enabled?: boolean;
  readonly status?: ServerProvider["status"];
  readonly availability?: ServerProvider["availability"];
  readonly models?: ServerProvider["models"];
}): ServerProvider {
  return {
    instanceId: input.instanceId as ServerProvider["instanceId"],
    driver: "codex" as ServerProvider["driver"],
    enabled: input.enabled ?? true,
    installed: true,
    version: "1",
    status: input.status ?? "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: input.models ?? [
      { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, capabilities: null },
    ],
    slashCommands: [],
    skills: [],
    ...(input.availability ? { availability: input.availability } : {}),
  };
}

describe("preferredWorktreeBaseBranch", () => {
  it("prefers the repository default over the current checkout", () => {
    expect(
      preferredWorktreeBaseBranch([
        ref("feature/local", { current: true }),
        ref("origin/master", { isRemote: true, remoteName: "origin", isDefault: true }),
      ]),
    ).toBe("master");
  });

  it("falls back to the current local branch when no default is advertised", () => {
    expect(
      preferredWorktreeBaseBranch([
        ref("trunk", { current: true }),
        ref("origin/main", { isRemote: true, remoteName: "origin" }),
      ]),
    ).toBe("trunk");
  });
});

describe("worktreeBaseExists", () => {
  it("matches a local or remote short name", () => {
    const refs = [ref("trunk"), ref("origin/trunk", { isRemote: true, remoteName: "origin" })];
    expect(worktreeBaseExists(refs, "trunk")).toBe(true);
    expect(worktreeBaseExists(refs, "main")).toBe(false);
  });
});

describe("enabledProviders", () => {
  it("drops disabled and unavailable instances", () => {
    expect(
      enabledProviders([
        provider({ instanceId: "codex", enabled: false }),
        provider({ instanceId: "claude", status: "disabled" }),
        provider({ instanceId: "grok", availability: "unavailable" }),
        provider({ instanceId: "ok" }),
      ]).map((entry) => entry.instanceId),
    ).toEqual(["ok"]);
  });
});

describe("firstEnabledProviderModel", () => {
  it("returns null when no enabled provider has a model", () => {
    expect(
      firstEnabledProviderModel([provider({ instanceId: "codex", enabled: false })]),
    ).toBeNull();
  });
});

describe("canSaveRoutineDraft", () => {
  it("requires an enabled provider", () => {
    expect(
      canSaveRoutineDraft({
        name: "Daily",
        instruction: "Summarize",
        hasProject: true,
        offline: false,
        busy: false,
        provider: provider({ instanceId: "codex", enabled: false }),
      }),
    ).toBe(false);
  });
});

describe("routinesLibraryEmptyKind", () => {
  it("does not treat an unavailable environment as an empty library", () => {
    expect(
      routinesLibraryEmptyKind({ routineCount: 0, unavailableCount: 1, pendingCount: 0 }),
    ).toBe("unavailable");
    expect(
      routinesLibraryEmptyKind({ routineCount: 0, unavailableCount: 0, pendingCount: 0 }),
    ).toBe("empty");
  });
});

describe("routine editor layout", () => {
  it("stacks the editor and wraps When-to-run so 1440 sidebar-open cannot overlay fields", () => {
    expect(ROUTINE_EDITOR_FIELDS_CLASS).toContain("grid-cols-1");
    expect(ROUTINE_EDITOR_FIELDS_CLASS).toContain("min-w-0");
    expect(ROUTINE_EDITOR_FIELDS_CLASS).not.toMatch(/\blg:grid-cols-2\b/);
    expect(ROUTINE_WHEN_TO_RUN_ACTIONS_CLASS).toContain("flex-wrap");
    expect(ROUTINE_WHEN_TO_RUN_ACTIONS_CLASS).not.toMatch(/\bsm:grid-cols-4\b/);
    expect(ROUTINE_CONTROL_CLASS).toContain("w-full");
    expect(ROUTINE_CONTROL_CLASS).toContain("min-w-0");
  });

  it("keeps the full permission-mode label", () => {
    expect(ROUTINE_PERMISSION_MODE_LABELS["approval-required"]).toBe(
      "Supervised · ask before changes",
    );
  });
});

describe("unsaved routine cancel", () => {
  it("treats an unchanged draft as clean and a typed draft as dirty", () => {
    const baseline = draft();
    expect(isRoutineDraftDirty(baseline, baseline)).toBe(false);
    expect(isRoutineDraftDirty(draft({ name: "Daily brief" }), baseline)).toBe(true);
  });

  it("documents that a canceled dirty draft is discarded without saving", () => {
    expect(DISCARD_UNSAVED_ROUTINE_MESSAGE).toContain("will not become a routine");
    expect(ROUTINE_CANCEL_HINT).toContain("canceled draft is not saved");
  });
});

describe("routine delete in the library", () => {
  it("drops the deleted card and keeps the editor source for history", () => {
    const enabled: { id: string; state: Routine["state"] } = {
      id: "routine-1",
      state: "enabled",
    };
    const deleted: { id: string; state: Routine["state"] } = {
      id: "routine-1",
      state: "deleted",
    };
    expect(libraryRoutinesAfterChange([enabled], deleted)).toEqual([]);
    expect(keepDeletedRoutineInEditor(deleted.state)).toBe(true);
    expect(DELETE_ROUTINE_MESSAGE).toContain("Conversations and run history stay available");
  });
});
