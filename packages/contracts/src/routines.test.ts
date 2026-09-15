import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  RoutineDraft,
  RoutineDraftGenerationInput,
  RoutineDraftGenerationResult,
  RoutineError,
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
