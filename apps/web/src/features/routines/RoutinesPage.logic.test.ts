import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  GitHubRoutineConnection,
  LinearRoutineConnection,
  Routine,
  RoutineDraft,
  RoutineDraftGenerationResult,
  ServerProvider,
  VcsRef,
} from "@kata-sh/code-contracts";
import {
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  RoutineConnectionId,
} from "@kata-sh/code-contracts";
import * as Schema from "effect/Schema";

import {
  canSaveRoutineDraft,
  confirmDialogAccepted,
  defaultGitHubTriggerDraft,
  defaultGitHubTrigger,
  defaultLinearTrigger,
  defaultLinearTriggerDraft,
  DELETE_ROUTINE_MESSAGE,
  formatRoutineTrigger,
  gitHubHookSettingsUrl,
  DISCARD_UNSAVED_ROUTINE_MESSAGE,
  enabledProviders,
  firstEnabledProviderModel,
  isRoutineDraftDirty,
  isCompleteGitHubTrigger,
  isCompleteLinearTrigger,
  isRoutineEditorDraftComplete,
  isRoutineEditorScheduleTrigger,
  keepDeletedRoutineInEditor,
  linearTriggerFiltersComplete,
  libraryRoutinesAfterChange,
  newRoutineDraftId,
  newRoutineConnectionId,
  newRoutineRequestId,
  preferredWorktreeBaseBranch,
  ROUTINE_CANCEL_HINT,
  ROUTINE_CONTROL_CLASS,
  ROUTINE_EDITOR_FIELDS_CLASS,
  ROUTINE_PERMISSION_MODE_LABELS,
  ROUTINE_WHEN_TO_RUN_ACTIONS_CLASS,
  routineConnectionStatusLabel,
  routineDraftBaselineAfterAutomaticChange,
  applyRoutineDraftGenerationResponse,
  routineDraftChatHistoryAfterTurn,
  routineDraftForGenerationInput,
  routineDraftRevisionAfterEdit,
  routinesLibraryEmptyKind,
  routineTriggerKind,
  selectableConnections,
  withApplicableLinearTriggerFilters,
  withApplicableTriggerFilters,
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

function connection(patch: Partial<GitHubRoutineConnection> = {}): GitHubRoutineConnection {
  return {
    id: RoutineConnectionId.make("connection-1"),
    environmentId: "environment-1" as GitHubRoutineConnection["environmentId"],
    provider: "github",
    repositoryId: 42,
    repositoryName: "acme/widgets",
    repositoryUrl: "https://github.com/acme/widgets",
    defaultBranch: "main",
    hookId: 1001,
    callbackUrl: "https://env.example/api/routines/webhooks/github/connection-1",
    status: "verified",
    lastDelivery: null,
    acceptedCount: 0,
    ignoredCount: 0,
    rejectedCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

function linearConnection(patch: Partial<LinearRoutineConnection> = {}): LinearRoutineConnection {
  return {
    id: RoutineConnectionId.make("connection-1"),
    environmentId: "environment-1" as LinearRoutineConnection["environmentId"],
    provider: "linear",
    workspaceId: "workspace-1",
    workspaceName: "Acme",
    teamIds: [],
    allTeams: true,
    webhookId: null,
    metadataAccess: "ok",
    callbackUrl: "https://env.example/api/routines/webhooks/linear/connection-1",
    status: "verified",
    lastDelivery: null,
    acceptedCount: 0,
    ignoredCount: 0,
    rejectedCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
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

describe("GitHub event triggers", () => {
  it("labels schedule and GitHub triggers for the library card", () => {
    expect(formatRoutineTrigger({ kind: "daily", time: "09:00", timezone: "UTC" })).toBe(
      "Daily at 09:00 · UTC",
    );
    expect(formatRoutineTrigger(defaultGitHubTrigger(connection()))).toBe(
      "GitHub · Pull request opened on main",
    );
    expect(routineTriggerKind(defaultGitHubTrigger(connection()))).toBe("github");
  });

  it("drops filters the selected event cannot use", () => {
    expect(
      withApplicableTriggerFilters({
        kind: "github",
        event: "issue_opened",
        branch: "main",
        includeDrafts: false,
      }),
    ).toEqual({ kind: "github", event: "issue_opened", includeDrafts: false });
    expect(
      withApplicableTriggerFilters({
        kind: "github",
        event: "pr_opened",
        branch: "main",
        includeDrafts: false,
        issueLabelId: 5,
      }),
    ).toEqual({ kind: "github", event: "pr_opened", branch: "main", includeDrafts: false });
    // A filter cleared to `undefined` is removed instead of reverting to the
    // value it had before the edit.
    expect(
      withApplicableTriggerFilters({
        kind: "github",
        event: "pr_opened",
        branch: undefined,
        includeDrafts: false,
      }),
    ).toEqual({ kind: "github", event: "pr_opened", includeDrafts: false });
    expect(
      withApplicableTriggerFilters({
        kind: "github",
        event: "issue_opened",
        includeDrafts: false,
        issueLabelId: undefined,
      }),
    ).toEqual({ kind: "github", event: "issue_opened", includeDrafts: false });
  });

  it("keeps an unconnected GitHub choice outside the saved trigger contract", () => {
    const trigger = defaultGitHubTriggerDraft();

    expect(trigger).toEqual({ kind: "github", event: "pr_opened", includeDrafts: false });
    expect(isCompleteGitHubTrigger(trigger)).toBe(false);
  });

  it("defaults a new GitHub trigger to PR opened on the repository default branch", () => {
    expect(defaultGitHubTrigger(connection({ defaultBranch: "develop" }))).toEqual({
      kind: "github",
      connectionId: "connection-1",
      repositoryId: 42,
      event: "pr_opened",
      branch: "develop",
      includeDrafts: false,
    });
  });

  it("hides disabled connections unless the routine already uses one", () => {
    const disabled = connection({
      id: RoutineConnectionId.make("connection-off"),
      status: "disabled",
    });
    expect(selectableConnections([connection(), disabled], null).map((entry) => entry.id)).toEqual([
      "connection-1",
    ]);
    expect(
      selectableConnections([connection(), disabled], "connection-off").map((entry) => entry.id),
    ).toEqual(["connection-1", "connection-off"]);
  });

  it("links to the provider delivery history only when a hook exists", () => {
    expect(gitHubHookSettingsUrl(connection())).toBe(
      "https://github.com/acme/widgets/settings/hooks/1001",
    );
    expect(gitHubHookSettingsUrl(connection({ hookId: null }))).toBeNull();
  });
});

describe("Linear event triggers", () => {
  it("treats a Linear trigger as an event trigger, not a schedule", () => {
    expect(isRoutineEditorScheduleTrigger({ kind: "linear", event: "issue_created" })).toBe(false);
    expect(isRoutineEditorScheduleTrigger({ kind: "daily", time: "09:00", timezone: "UTC" })).toBe(
      true,
    );
  });

  it("keeps an unconnected Linear choice outside the saved trigger contract", () => {
    expect(isCompleteLinearTrigger({ kind: "linear", event: "issue_created" })).toBe(false);
    expect(
      isCompleteLinearTrigger({
        kind: "linear",
        event: "issue_created",
        connectionId: RoutineConnectionId.make("connection-1"),
        workspaceId: "workspace-1",
      }),
    ).toBe(true);
  });

  it("treats a draft with a complete Linear trigger as saveable", () => {
    expect(
      isRoutineEditorDraftComplete(draft({ trigger: defaultLinearTrigger(linearConnection()) })),
    ).toBe(true);
    expect(isRoutineEditorDraftComplete({ ...draft(), trigger: defaultLinearTriggerDraft() })).toBe(
      false,
    );
  });

  it("links GitHub webhook settings only for GitHub connections", () => {
    expect(gitHubHookSettingsUrl(linearConnection())).toBeNull();
  });

  it("labels a pending connection with the provider-specific wait", () => {
    expect(routineConnectionStatusLabel({ provider: "github", status: "pending" })).toBe(
      "Waiting for GitHub ping",
    );
    expect(routineConnectionStatusLabel({ provider: "linear", status: "pending" })).toBe(
      "Waiting for the first delivery",
    );
    expect(routineConnectionStatusLabel({ provider: "linear", status: "verified" })).toBe(
      "Verified",
    );
    expect(routineConnectionStatusLabel({ provider: "github", status: "disabled" })).toBe(
      "Disabled",
    );
    expect(routineConnectionStatusLabel({ provider: "linear", status: "unavailable" })).toBe(
      "Unavailable",
    );
  });

  it("sends the editor state for a schedule or a complete Linear trigger only", () => {
    const scheduled = draft({ name: "Daily brief" });
    expect(routineDraftForGenerationInput(scheduled, true)).toEqual(scheduled);

    const linear = draft({
      name: "Linear brief",
      trigger: defaultLinearTrigger(linearConnection()),
    });
    expect(routineDraftForGenerationInput(linear, true)).toEqual(linear);

    expect(
      routineDraftForGenerationInput(draft({ trigger: defaultGitHubTrigger(connection()) }), true),
    ).toBeNull();
    expect(
      routineDraftForGenerationInput({ ...draft(), trigger: defaultLinearTriggerDraft() }, true),
    ).toBeNull();

    const linearScope = defaultLinearTrigger(linearConnection());
    expect(
      routineDraftForGenerationInput(
        { ...draft(), trigger: { ...linearScope, event: "status_changed" } },
        true,
      ),
    ).toBeNull();
    expect(
      routineDraftForGenerationInput(
        { ...draft(), trigger: { ...linearScope, event: "label_added" } },
        true,
      ),
    ).toBeNull();
    expect(
      linearTriggerFiltersComplete({ ...linearScope, event: "status_changed", stateId: "" }),
    ).toBe(false);
    expect(
      linearTriggerFiltersComplete({ ...linearScope, event: "label_added", labelId: "   " }),
    ).toBe(false);
    expect(
      routineDraftForGenerationInput(
        {
          ...draft(),
          trigger: { ...linearScope, event: "status_changed", stateId: "state-1" },
        },
        true,
      )?.trigger,
    ).toEqual({ ...linearScope, event: "status_changed", stateId: "state-1" });
    expect(
      routineDraftForGenerationInput(
        {
          ...draft(),
          trigger: { ...linearScope, event: "label_added", labelId: "label-1" },
        },
        true,
      )?.trigger,
    ).toEqual({ ...linearScope, event: "label_added", labelId: "label-1" });
  });

  it("defaults a new Linear trigger to issue created on a single scoped team", () => {
    expect(
      defaultLinearTrigger(linearConnection({ teamIds: ["team-1"], allTeams: false })),
    ).toEqual({
      kind: "linear",
      connectionId: "connection-1",
      workspaceId: "workspace-1",
      event: "issue_created",
      teamId: "team-1",
    });
    const multipleTeams = defaultLinearTrigger(
      linearConnection({ teamIds: ["team-1", "team-2"], allTeams: false }),
    );
    expect(multipleTeams).toEqual({
      kind: "linear",
      connectionId: "connection-1",
      workspaceId: "workspace-1",
      event: "issue_created",
    });
    expect("teamId" in multipleTeams).toBe(false);
  });

  it("drops Linear filters the selected event cannot use", () => {
    expect(
      withApplicableLinearTriggerFilters({
        kind: "linear",
        event: "status_changed",
        stateId: "state-1",
        labelId: "label-1",
      }),
    ).toEqual({ kind: "linear", event: "status_changed", stateId: "state-1" });
    expect(
      withApplicableLinearTriggerFilters({
        kind: "linear",
        event: "label_added",
        stateId: "state-1",
        labelId: "label-1",
      }),
    ).toEqual({ kind: "linear", event: "label_added", labelId: "label-1" });
    expect(
      withApplicableLinearTriggerFilters({
        kind: "linear",
        event: "issue_created",
        teamId: undefined,
        projectId: undefined,
      }),
    ).toEqual({ kind: "linear", event: "issue_created" });
  });

  it("labels each Linear event for the library card", () => {
    const scope = {
      kind: "linear" as const,
      connectionId: RoutineConnectionId.make("connection-1"),
      workspaceId: "workspace-1",
    };
    expect(formatRoutineTrigger({ ...scope, event: "issue_created" })).toBe(
      "Linear · Issue created",
    );
    expect(formatRoutineTrigger({ ...scope, event: "status_changed", stateId: "state-1" })).toBe(
      "Linear · Status changed",
    );
    expect(formatRoutineTrigger({ ...scope, event: "label_added", labelId: "label-1" })).toBe(
      "Linear · Label added",
    );
  });

  it("names schedule, GitHub, and Linear trigger kinds for the editor", () => {
    expect(routineTriggerKind({ kind: "daily", time: "09:00", timezone: "UTC" })).toBe("schedule");
    expect(routineTriggerKind(defaultGitHubTriggerDraft())).toBe("github");
    expect(routineTriggerKind({ kind: "linear", event: "issue_created" })).toBe("linear");
  });
});

describe("routine identity generation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives every new routine draft a distinct id with the draft prefix", () => {
    const first = newRoutineDraftId();
    const second = newRoutineDraftId();
    expect(first).not.toBe(second);
    expect(first.startsWith("routine-draft-")).toBe(true);
    expect(second.startsWith("routine-draft-")).toBe(true);
    const batch = Array.from({ length: 100 }, () => newRoutineDraftId());
    expect(new Set(batch).size).toBe(batch.length);
  });

  it("gives every new test-run request a distinct id with the request prefix", () => {
    const first = newRoutineRequestId();
    const second = newRoutineRequestId();
    expect(first).not.toBe(second);
    expect(first.startsWith("routine-request-")).toBe(true);
    expect(second.startsWith("routine-request-")).toBe(true);
    const batch = Array.from({ length: 100 }, () => newRoutineRequestId());
    expect(new Set(batch).size).toBe(batch.length);
  });

  it("keeps ids unique and clock-independent when the wall clock is frozen", () => {
    const frozenNow = 1_800_000_000_000;
    const legacyTimestamp = frozenNow.toString(36);
    vi.spyOn(Date, "now").mockReturnValue(frozenNow);
    const draftIds = Array.from({ length: 100 }, () => newRoutineDraftId());
    const requestIds = Array.from({ length: 100 }, () => newRoutineRequestId());
    expect(new Set(draftIds).size).toBe(draftIds.length);
    expect(new Set(requestIds).size).toBe(requestIds.length);
    expect(draftIds.some((id) => id.includes(legacyTimestamp))).toBe(false);
    expect(requestIds.some((id) => id.includes(legacyTimestamp))).toBe(false);
  });

  it("does not repeat an id across separate module instances at the same instant", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    vi.resetModules();
    const firstInstance = await import("./RoutinesPage.logic");
    vi.resetModules();
    const secondInstance = await import("./RoutinesPage.logic");
    expect(firstInstance.newRoutineDraftId()).not.toBe(secondInstance.newRoutineDraftId());
    expect(firstInstance.newRoutineRequestId()).not.toBe(secondInstance.newRoutineRequestId());
  });

  it("gives two clients distinct valid connection ids in the same millisecond", async () => {
    const frozenNow = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(frozenNow);
    vi.resetModules();
    const firstClient = await import("./RoutinesPage.logic");
    vi.resetModules();
    const secondClient = await import("./RoutinesPage.logic");
    const ids = [firstClient.newRoutineConnectionId(), secondClient.newRoutineConnectionId()];
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) {
      expect(id).toMatch(
        /^connection-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
      expect(Schema.decodeSync(RoutineConnectionId)(id)).toBe(id);
      expect(id.includes(frozenNow.toString(36))).toBe(false);
    }
    const batch = Array.from({ length: 100 }, () => newRoutineConnectionId());
    expect(new Set(batch).size).toBe(batch.length);
  });
});
