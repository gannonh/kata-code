import { describe, expect, it } from "vite-plus/test";
import type {
  Routine,
  RoutineDraft,
  RoutineDraftGenerationResult,
  ServerProvider,
  VcsRef,
} from "@kata-sh/code-contracts";
import { ModelSelection, ProjectId, ProviderInstanceId } from "@kata-sh/code-contracts";
import * as Schema from "effect/Schema";

import {
  canSaveRoutineDraft,
  confirmDialogAccepted,
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
  routineDraftBaselineAfterAutomaticChange,
  applyRoutineDraftGenerationResponse,
  routineDraftChatHistoryAfterTurn,
  routineDraftForGenerationInput,
  routineDraftRevisionAfterEdit,
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

  it("treats a missing confirm host as cancellation", () => {
    expect(confirmDialogAccepted(undefined)).toBe(false);
    expect(confirmDialogAccepted(false)).toBe(false);
    expect(confirmDialogAccepted(true)).toBe(true);
  });

  it("adopts automatic workspace-branch init as the baseline when the draft is still clean", () => {
    const worktree = {
      kind: "worktree" as const,
      baseBranch: "main",
      startFromOrigin: true,
      runSetupScript: true,
    };
    const baseline = draft({ workspace: worktree });
    const next = draft({ workspace: { ...worktree, baseBranch: "develop" } });
    expect(routineDraftBaselineAfterAutomaticChange(baseline, baseline, next)).toEqual(next);
    expect(isRoutineDraftDirty(next, next)).toBe(false);
  });

  it("keeps the baseline when the user already edited the draft", () => {
    const worktree = {
      kind: "worktree" as const,
      baseBranch: "main",
      startFromOrigin: true,
      runSetupScript: true,
    };
    const baseline = draft({ workspace: worktree });
    const current = draft({ name: "Daily brief", workspace: worktree });
    const next = draft({ name: "Daily brief", workspace: { ...worktree, baseBranch: "develop" } });
    expect(routineDraftBaselineAfterAutomaticChange(current, baseline, next)).toEqual(baseline);
    expect(isRoutineDraftDirty(next, baseline)).toBe(true);
  });
});

describe("routine draft chat state", () => {
  it("increments the revision for a real manual edit while ignoring equal values", () => {
    const baseline = draft();
    expect(routineDraftRevisionAfterEdit(baseline, baseline, 3)).toBe(3);
    expect(routineDraftRevisionAfterEdit(baseline, draft({ name: "Daily brief" }), 3)).toBe(4);
  });

  it("keeps only the latest ten conversation turns", () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      id: index,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message-${index}`,
    }));
    let nextId = 100;
    const next = routineDraftChatHistoryAfterTurn(
      history,
      "new request",
      "new answer",
      () => ++nextId,
    );
    expect(next).toHaveLength(20);
    expect(next[0]?.content).toBe("message-2");
    expect(next.at(-2)).toMatchObject({ id: 101, content: "new request", role: "user" });
    expect(next.at(-1)).toMatchObject({ id: 102, content: "new answer", role: "assistant" });
  });

  it("applies a current response while preserving the manual runtime and workspace", () => {
    const current = draft({
      name: "Manual name",
      runtimeMode: "full-access",
      workspace: { kind: "shared", directory: "/manual/workspace" },
    });
    const generated = draft({
      name: "Generated name",
      instruction: "Summarize the repository",
      runtimeMode: "approval-required",
      workspace: {
        kind: "worktree",
        baseBranch: "main",
        startFromOrigin: true,
        runSetupScript: true,
      },
    });
    const response: RoutineDraftGenerationResult = {
      draft: generated,
      assistantMessage: "I prepared the routine.",
      draftRevision: 2,
    };
    expect(applyRoutineDraftGenerationResponse(current, 2, response)).toEqual({
      status: "applied",
      draft: {
        ...generated,
        runtimeMode: current.runtimeMode,
        workspace: current.workspace,
      },
      revision: 3,
    });
  });

  it("uses server workspace defaults when generation changes the project", () => {
    const current = draft({
      runtimeMode: "full-access",
      workspace: { kind: "shared", directory: "/manual/workspace" },
    });
    const generated = draft({
      projectId: ProjectId.make("project-2"),
      workspace: {
        kind: "worktree",
        baseBranch: "main",
        startFromOrigin: true,
        runSetupScript: true,
      },
    });
    const response: RoutineDraftGenerationResult = {
      draft: generated,
      assistantMessage: "I moved the routine to the other project.",
      draftRevision: 2,
    };
    expect(applyRoutineDraftGenerationResponse(current, 2, response)).toMatchObject({
      status: "applied",
      draft: {
        projectId: ProjectId.make("project-2"),
        runtimeMode: "full-access",
        workspace: generated.workspace,
      },
    });
  });

  it("returns a stale response as a review offer without changing the current draft", () => {
    const current = draft({ name: "User edit" });
    const generated = draft({ name: "Old generated name" });
    const response: RoutineDraftGenerationResult = {
      draft: generated,
      assistantMessage: "I prepared the routine.",
      draftRevision: 1,
    };
    expect(applyRoutineDraftGenerationResponse(current, 2, response)).toEqual({
      status: "stale",
      draft: current,
      revision: 2,
      reviewDraft: {
        ...generated,
        runtimeMode: current.runtimeMode,
        workspace: current.workspace,
      },
    });
  });

  it("leaves the draft and revision unchanged for a clarification response", () => {
    const current = draft({ name: "User edit" });
    const response: RoutineDraftGenerationResult = {
      draft: null,
      assistantMessage: "Which timezone should I use?",
      draftRevision: 2,
    };
    expect(applyRoutineDraftGenerationResponse(current, 2, response)).toEqual({
      status: "clarification",
      draft: current,
      revision: 2,
    });
  });

  it("omits an untouched initial draft so the assistant does not treat defaults as user input", () => {
    expect(routineDraftForGenerationInput(draft(), false)).toBeNull();
  });

  it("sends the authoritative editor state once the draft is initialized", () => {
    const touched = draft({ name: "Daily brief", instruction: "Summarize recent changes" });
    expect(routineDraftForGenerationInput(touched, true)).toEqual(touched);
  });

  it("carries mid-edit blank fields after initialization instead of dropping manual edits", () => {
    const midEdit = draft({
      name: "",
      instruction: "",
      trigger: { kind: "daily", time: "15:00", timezone: "America/Los_Angeles" },
    });
    expect(routineDraftForGenerationInput(midEdit, true)).toEqual(midEdit);
  });

  it("keeps manual editor fields when a generated response applies on the matching revision", () => {
    const current = draft({
      name: "Manual name",
      instruction: "Manual instruction",
      runtimeMode: "full-access",
      workspace: { kind: "shared", directory: "/manual/workspace" },
      trigger: { kind: "daily", time: "15:00", timezone: "America/Los_Angeles" },
    });
    const response: RoutineDraftGenerationResult = {
      draft: draft({ name: "Generated name", instruction: "Generated instruction" }),
      assistantMessage: "I refined the routine.",
      draftRevision: 4,
    };
    const applied = applyRoutineDraftGenerationResponse(current, 4, response);
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") return;
    expect(applied.draft.runtimeMode).toBe("full-access");
    expect(applied.draft.workspace).toEqual({ kind: "shared", directory: "/manual/workspace" });
    expect(applied.draft.name).toBe("Generated name");
    expect(applied.draft.instruction).toBe("Generated instruction");
    expect(applied.revision).toBe(5);
  });

  it("offers review instead of overwriting manual edits made while refining", () => {
    const current = draft({
      name: "Manual name",
      runtimeMode: "full-access",
      workspace: { kind: "shared", directory: "/manual/workspace" },
    });
    const generated = draft({ name: "Old generated name" });
    const response: RoutineDraftGenerationResult = {
      draft: generated,
      assistantMessage: "I refined the routine.",
      draftRevision: 3,
    };
    expect(applyRoutineDraftGenerationResponse(current, 4, response)).toMatchObject({
      status: "stale",
      revision: 4,
      reviewDraft: {
        name: "Old generated name",
        runtimeMode: "full-access",
        workspace: current.workspace,
      },
    });
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
