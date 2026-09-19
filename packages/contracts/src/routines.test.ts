import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  RoutineDraft,
  RoutineDraftConversationState,
  RoutineDraftGeneratedFields,
  RoutineDraftGenerationInput,
  RoutineDraftGenerationResult,
  RoutineDraftProviderOutput,
  RoutineError,
  RoutineConnection,
  RoutineConnectionAuthorization,
  RoutineConnectionCreateInput,
  RoutineLinearMetadata,
  RoutineRun,
  ScheduleTrigger,
  isScheduleTrigger,
  previewRoutineSchedule,
} from "./routines.ts";

const decodeTrigger = Schema.decodeUnknownSync(ScheduleTrigger);
const testDate = (iso: string) => DateTime.toDateUtc(DateTime.makeUnsafe(iso));
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-astra" };

describe("scheduled routine schedules", () => {
  it("builds a five-field expression and three upcoming local occurrences", () => {
    const trigger = decodeTrigger({
      kind: "weekdays",
      time: "09:30",
      timezone: "America/Los_Angeles",
    });
    const preview = previewRoutineSchedule(trigger, testDate("2026-01-01T00:00:00.000Z"));

    expect(preview.expression).toBe("30 9 * * 1-5");
    expect(preview.dates).toHaveLength(3);
    expect(
      preview.dates.every((date) => Number.isFinite(DateTime.makeUnsafe(date).epochMilliseconds)),
    ).toBe(true);
  });

  it("uses the timezone rules when a preview crosses daylight saving time", () => {
    const trigger = decodeTrigger({
      kind: "daily",
      time: "01:30",
      timezone: "America/Los_Angeles",
    });
    const preview = previewRoutineSchedule(trigger, testDate("2026-03-07T12:00:00.000Z"));

    const utcHour = (iso: string) =>
      Math.floor(DateTime.makeUnsafe(iso).epochMilliseconds / 3_600_000) % 24;
    expect(utcHour(preview.dates[0]!)).not.toBe(utcHour(preview.dates[2]!));
  });

  it("rejects invalid zones and cron shapes at the contract boundary", () => {
    expect(() =>
      previewRoutineSchedule(
        decodeTrigger({ kind: "daily", time: "09:00", timezone: "Mars/Olympus" }),
        testDate("2026-01-01T00:00:00.000Z"),
      ),
    ).toThrow(RoutineError);
    expect(() =>
      previewRoutineSchedule(
        decodeTrigger({ kind: "cron", expression: "0 9 * * * *", timezone: "UTC" }),
        testDate("2026-01-01T00:00:00.000Z"),
      ),
    ).toThrow(RoutineError);
  });
});

const decodeDraftRequest = Schema.decodeUnknownSync(RoutineDraftGenerationInput);
const decodeDraftResult = Schema.decodeUnknownSync(RoutineDraftGenerationResult);
describe("routine draft generation contracts", () => {
  it("emits strict nullable Linear scope fields and decodes null as an omitted filter", () => {
    const document = Schema.toJsonSchemaDocument(RoutineDraftProviderOutput);
    const linearObjects: Array<{ readonly required?: ReadonlyArray<string> }> = [];
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      const object = value as {
        readonly properties?: Record<string, unknown>;
        readonly required?: ReadonlyArray<string>;
      };
      if (object.properties?.teamId !== undefined) linearObjects.push(object);
      for (const child of Object.values(value)) visit(child);
    };
    visit(document);
    expect(linearObjects).toHaveLength(3);
    expect(
      linearObjects.every(
        (object) => object.required?.includes("teamId") && object.required.includes("projectId"),
      ),
    ).toBe(true);

    const decoded = Schema.decodeUnknownSync(RoutineDraftProviderOutput)({
      draft: {
        name: "Linear triage",
        instruction: "Triage the issue",
        projectId: "project-1",
        modelSelection,
        trigger: {
          kind: "linear",
          connectionId: "connection-1",
          workspaceId: "workspace-1",
          teamId: null,
          projectId: null,
          event: "issue_created",
        },
      },
      assistantMessage: "Drafted a Linear triage routine.",
    });
    expect(decoded.draft?.trigger).toEqual({
      kind: "linear",
      connectionId: "connection-1",
      workspaceId: "workspace-1",
      event: "issue_created",
    });
  });

  it("accepts a bounded conversational request and a clarification result", () => {
    const input = decodeDraftRequest({
      message: "Run a weekday brief at 9am",
      currentDraft: null,
      draftRevision: 0,
      history: [{ role: "user", content: "Run a weekday brief at 9am" }],
      projectId: ProjectId.make("project-1"),
      generationModelSelection: modelSelection,
    });
    expect(input.history).toHaveLength(1);
    expect(
      decodeDraftRequest({ ...input, history: Array.from({ length: 20 }, () => input.history[0]) })
        .history,
    ).toHaveLength(20);
    expect(() =>
      decodeDraftRequest({ ...input, history: Array.from({ length: 21 }, () => input.history[0]) }),
    ).toThrow();

    const result = decodeDraftResult({
      draft: null,
      assistantMessage: "Which project should own this routine?",
      draftRevision: 0,
    });
    expect(result.draft).toBeNull();
    expect(result.assistantMessage).toContain("project");
  });

  it("accepts a mid-edit current draft so refinements carry authoritative editor state", () => {
    const input = decodeDraftRequest({
      message: "Move it to 3pm",
      currentDraft: {
        name: "",
        instruction: "",
        projectId: ProjectId.make("project-1"),
        modelSelection,
        runtimeMode: "approval-required",
        workspace: { kind: "shared", directory: "/project" },
        trigger: { kind: "weekdays", time: "09:00", timezone: "UTC" },
      },
      draftRevision: 2,
      history: [],
      projectId: ProjectId.make("project-1"),
      generationModelSelection: modelSelection,
    });
    expect(input.currentDraft?.name).toBe("");
    expect(input.currentDraft?.trigger).toEqual({
      kind: "weekdays",
      time: "09:00",
      timezone: "UTC",
    });
  });
});

describe("routine trigger union", () => {
  const decodeDraft = Schema.decodeUnknownSync(RoutineDraft);
  const base = {
    name: "PR reviewer",
    instruction: "Review the pull request.",
    projectId: "project-1",
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "approval-required",
    workspace: { kind: "shared", directory: "/tmp/project" },
  };

  it("accepts a GitHub event trigger keyed on stable ids", () => {
    const draft = decodeDraft({
      ...base,
      trigger: {
        kind: "github",
        connectionId: "connection-1",
        repositoryId: 42,
        event: "pr_opened",
        branch: "main",
        includeDrafts: false,
      },
    });
    expect(draft.trigger.kind).toBe("github");
    expect(isScheduleTrigger(draft.trigger)).toBe(false);
    expect(isScheduleTrigger({ kind: "daily", time: "09:00", timezone: "UTC" })).toBe(true);
  });

  it("rejects unknown GitHub events and non-positive repository ids", () => {
    expect(() =>
      decodeDraft({
        ...base,
        trigger: {
          kind: "github",
          connectionId: "connection-1",
          repositoryId: 0,
          event: "pr_opened",
          includeDrafts: true,
        },
      }),
    ).toThrow();
    expect(() =>
      decodeDraft({
        ...base,
        trigger: {
          kind: "github",
          connectionId: "connection-1",
          repositoryId: 42,
          event: "push",
          includeDrafts: true,
        },
      }),
    ).toThrow();
  });

  it("admits github as a run source with an optional source link", () => {
    const decodeRun = Schema.decodeUnknownSync(RoutineRun);
    const run = decodeRun({
      id: "run-1",
      routineId: "routine-1",
      environmentId: "environment-1",
      revision: 1,
      configuration: {
        ...base,
        trigger: {
          kind: "github",
          connectionId: "connection-1",
          repositoryId: 42,
          event: "pr_opened",
          includeDrafts: false,
        },
      },
      occurrenceKey: "github:delivery-1",
      source: "github",
      sourceUrl: "https://github.com/acme/widgets/pull/7",
      threadId: "thread-1",
      messageId: "message-1",
      commandId: "command-1",
      conversation: { kind: "unconfirmed" },
      status: "queued",
      stage: "admitted",
      turnId: null,
      detail: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(run.source).toBe("github");
    expect(run.sourceUrl).toBe("https://github.com/acme/widgets/pull/7");
  });
});

describe("linear trigger union", () => {
  const decodeDraft = Schema.decodeUnknownSync(RoutineDraft);
  const base = {
    name: "Issue triage",
    instruction: "Triage the issue.",
    projectId: "project-1",
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "approval-required",
    workspace: { kind: "shared", directory: "/tmp/project" },
  };

  it("accepts a Linear issue trigger keyed on stable ids", () => {
    const draft = decodeDraft({
      ...base,
      trigger: {
        kind: "linear",
        connectionId: "connection-1",
        workspaceId: "workspace-uuid",
        event: "status_changed",
        stateId: "state-uuid",
      },
    });
    expect(draft.trigger.kind).toBe("linear");
    expect(isScheduleTrigger(draft.trigger)).toBe(false);
    expect(isScheduleTrigger({ kind: "daily", time: "09:00", timezone: "UTC" })).toBe(true);
  });

  it("requires transition or label evidence for the Linear update events", () => {
    expect(() =>
      decodeDraft({
        ...base,
        trigger: {
          kind: "linear",
          connectionId: "connection-1",
          workspaceId: "workspace-uuid",
          event: "status_changed",
        },
      }),
    ).toThrow();
    expect(() =>
      decodeDraft({
        ...base,
        trigger: {
          kind: "linear",
          connectionId: "connection-1",
          workspaceId: "workspace-uuid",
          event: "label_added",
        },
      }),
    ).toThrow();
    const created = decodeDraft({
      ...base,
      trigger: {
        kind: "linear",
        connectionId: "connection-1",
        workspaceId: "workspace-uuid",
        event: "issue_created",
        teamId: "team-uuid",
      },
    });
    expect(created.trigger.kind).toBe("linear");
  });

  it("admits Linear triggers in generated fields and conversation state with event evidence", () => {
    const decodeFields = Schema.decodeUnknownSync(RoutineDraftGeneratedFields);
    const decodeState = Schema.decodeUnknownSync(RoutineDraftConversationState);
    const linearTrigger = {
      kind: "linear",
      connectionId: "connection-1",
      workspaceId: "workspace-uuid",
      event: "status_changed",
      stateId: "state-uuid",
    };
    const generated = decodeFields({
      name: "Issue triage",
      instruction: "Triage the issue.",
      projectId: "project-1",
      modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      trigger: linearTrigger,
    });
    expect(generated.trigger.kind).toBe("linear");
    const state = decodeState({
      name: "",
      instruction: "",
      projectId: "project-1",
      modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      runtimeMode: "approval-required",
      workspace: { kind: "shared", directory: "/tmp/project" },
      trigger: linearTrigger,
    });
    expect(state.trigger.kind).toBe("linear");
    expect(() =>
      decodeFields({
        name: "Issue triage",
        instruction: "Triage the issue.",
        projectId: "project-1",
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        trigger: {
          kind: "linear",
          connectionId: "connection-1",
          workspaceId: "workspace-uuid",
          event: "status_changed",
        },
      }),
    ).toThrow();
  });

  it("admits linear as a run source with an optional source link", () => {
    const decodeRun = Schema.decodeUnknownSync(RoutineRun);
    const run = decodeRun({
      id: "run-1",
      routineId: "routine-1",
      environmentId: "environment-1",
      revision: 1,
      configuration: {
        ...base,
        trigger: {
          kind: "linear",
          connectionId: "connection-1",
          workspaceId: "workspace-uuid",
          event: "issue_created",
        },
      },
      occurrenceKey: "linear:delivery-1",
      source: "linear",
      sourceUrl: "https://linear.app/acme/issue/ENG-7",
      threadId: "thread-1",
      messageId: "message-1",
      commandId: "command-1",
      conversation: { kind: "unconfirmed" },
      status: "queued",
      stage: "admitted",
      turnId: null,
      detail: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(run.source).toBe("linear");
    expect(run.sourceUrl).toBe("https://linear.app/acme/issue/ENG-7");
  });
});

describe("routine connection records", () => {
  const decodeConnection = Schema.decodeUnknownSync(RoutineConnection);
  const base = {
    id: "connection-1",
    environmentId: "environment-1",
    callbackUrl: "https://example.test/api/routines/webhooks/linear/connection-1",
    status: "pending",
    lastDelivery: null,
    acceptedCount: 0,
    ignoredCount: 0,
    rejectedCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("discriminates Linear and GitHub connection records by provider", () => {
    const linear = decodeConnection({
      ...base,
      provider: "linear",
      workspaceId: "workspace-uuid",
      workspaceName: "Acme",
      teamIds: ["team-1"],
      allTeams: false,
      webhookId: "webhook-uuid",
      metadataAccess: "ok",
    });
    expect(linear.provider).toBe("linear");
    if (linear.provider === "linear") expect(linear.webhookId).toBe("webhook-uuid");
    const github = decodeConnection({
      ...base,
      provider: "github",
      repositoryId: 42,
      repositoryName: "acme/widgets",
      repositoryUrl: "https://github.com/acme/widgets",
      defaultBranch: "main",
      hookId: 7,
    });
    expect(github.provider).toBe("github");
    expect(() =>
      decodeConnection({ ...base, provider: "slack", workspaceId: "workspace-uuid" }),
    ).toThrow();
  });

  it("carries Linear workspace, team, project, state, and label metadata", () => {
    const decodeMetadata = Schema.decodeUnknownSync(RoutineLinearMetadata);
    const metadata = decodeMetadata({
      workspace: { id: "workspace-uuid", name: "Acme", urlKey: "acme" },
      teams: [{ id: "team-1", name: "Engineering", key: "ENG" }],
      projects: [{ id: "project-1", name: "Roadmap", teamIds: ["team-1"] }],
      states: [{ id: "state-1", name: "In Progress", teamId: "team-1", type: "started" }],
      labels: [
        { id: "label-1", name: "Bug", teamId: "team-1" },
        { id: "label-2", name: "Workspace label", teamId: null },
      ],
    });
    expect(metadata.teams[0]?.key).toBe("ENG");
    expect(metadata.states[0]?.type).toBe("started");
    expect(metadata.labels[1]?.teamId).toBeNull();
  });

  it("accepts the client identifier shape and rejects path-like values", () => {
    const decodeCreateInput = Schema.decodeUnknownSync(RoutineConnectionCreateInput);
    expect(
      decodeCreateInput({
        provider: "github",
        id: " connection_1-abc ",
        repository: "acme/widgets",
      }).id,
    ).toBe("connection_1-abc");
    for (const id of ["../escape", "connection/secret", "connection.with.dot", "a".repeat(129)]) {
      expect(() =>
        decodeCreateInput({ provider: "github", id, repository: "acme/widgets" }),
      ).toThrow();
    }
    const linear = decodeCreateInput({
      provider: "linear",
      id: "connection-linear",
      allTeams: true,
      teamIds: [],
    });
    expect(linear.provider).toBe("linear");
  });

  it("decodes a Linear authorization URL and rejects a blank one", () => {
    const decodeAuthorization = Schema.decodeUnknownSync(RoutineConnectionAuthorization);
    expect(
      decodeAuthorization({ authorizeUrl: "https://linear.app/oauth/authorize?state=abc" })
        .authorizeUrl,
    ).toBe("https://linear.app/oauth/authorize?state=abc");
    expect(() => decodeAuthorization({ authorizeUrl: " " })).toThrow();
    expect(() => decodeAuthorization({})).toThrow();
  });
});
