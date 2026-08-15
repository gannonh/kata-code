import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  TASK_CLI_AMENDMENT_PATH,
  TASK_CLI_ARTIFACT_MAX_CHARS,
  TASK_CLI_CHECK_BEGIN_PATH,
  TASK_CLI_CHECK_FINALIZE_PATH,
  TASK_CLI_COMPLETE_PATH,
  TASK_CLI_CONTEXT_PATH,
  TASK_CLI_IMPLEMENTATION_COMMAND_CONTRACT,
  TASK_CLI_PLANNING_COMMANDS,
  TASK_CLI_PLANNING_COMPLETION_CONTRACT,
  TASK_CLI_PROGRESS_PATH,
  TASK_CLI_PROTOCOL,
  TASK_CLI_RESPONSE_MAX_CHARS,
  TASK_CLI_SUMMARY_MAX_CHARS,
  TaskCliAmendmentEnvelope,
  TaskCliAmendmentRequest,
  TaskCliCheckBeginEnvelope,
  TaskCliCheckBeginRequest,
  TaskCliCheckFinalizeEnvelope,
  TaskCliCheckFinalizeRequest,
  TaskCliCompleteEnvelope,
  TaskCliCompleteRequest,
  TaskCliContextEnvelope,
  TaskCliErrorCode,
  TaskCliProgressEnvelope,
  TaskCliProgressRequest,
} from "./taskCli.ts";

describe("Task CLI contracts", () => {
  it("decodes a versioned context success envelope with next commands", () => {
    const decode = Schema.decodeUnknownSync(TaskCliContextEnvelope);
    expect(
      decode({
        protocol: TASK_CLI_PROTOCOL,
        ok: true,
        operation: "context",
        context: {
          stage: "questions",
          occurrence: 0,
          brief: "Add a task CLI.",
          feedback: null,
          artifacts: [],
        },
        commands: TASK_CLI_PLANNING_COMMANDS,
      }),
    ).toMatchObject({
      protocol: "task-cli@1",
      ok: true,
      operation: "context",
      commands: TASK_CLI_PLANNING_COMMANDS,
    });
    expect(TASK_CLI_CONTEXT_PATH).toBe("/api/task-cli/v1/context");
  });

  it("rejects an unallowlisted context operation", () => {
    const decode = Schema.decodeUnknownSync(TaskCliContextEnvelope);
    expect(() =>
      decode({
        protocol: TASK_CLI_PROTOCOL,
        ok: true,
        operation: "dispatch",
        context: {},
      }),
    ).toThrow();
  });

  it("keeps errors on a stable closed code set", () => {
    const decode = Schema.decodeUnknownSync(TaskCliErrorCode);
    expect(decode("stale_lease")).toBe("stale_lease");
    expect(decode("conflict")).toBe("conflict");
    expect(decode("invalid_artifact")).toBe("invalid_artifact");
    expect(decode("payload_too_large")).toBe("payload_too_large");
    expect(decode("check_indeterminate")).toBe("check_indeterminate");
    expect(() => decode("task_internal_command")).toThrow();
  });
});

describe("implementation Task CLI contracts", () => {
  const successBase = { protocol: TASK_CLI_PROTOCOL, ok: true as const };

  it("decodes progress success and failure envelopes", () => {
    const decode = Schema.decodeUnknownSync(TaskCliProgressEnvelope);
    expect(
      decode({
        ...successBase,
        operation: "progress",
        accepted: true,
        phaseId: "phase:foundation",
        workItemId: null,
        status: "running",
        taskRevision: 4,
      }),
    ).toMatchObject({ ok: true, operation: "progress", phaseId: "phase:foundation" });
    expect(
      decode({
        protocol: TASK_CLI_PROTOCOL,
        ok: false,
        operation: "progress",
        error: { code: "conflict", message: "blocked" },
      }),
    ).toMatchObject({ ok: false, operation: "progress" });
    expect(TASK_CLI_PROGRESS_PATH).toBe("/api/task-cli/v1/progress");
  });

  it("decodes check begin success and failure envelopes", () => {
    const decode = Schema.decodeUnknownSync(TaskCliCheckBeginEnvelope);
    expect(
      decode({
        ...successBase,
        operation: "check",
        accepted: true,
        attemptId: "check-attempt-1",
        checkId: "check:typecheck",
        attemptNumber: 1,
        command: "vp run typecheck",
        cwd: "/worktree",
        timeoutMs: 120_000,
        maxOutputBytes: 1_048_576,
        outcome: "spawn",
        finalizerToken: "opaque-token",
        startingCommitSha: "deadbeef",
        startingStatus: "",
        taskRevision: 4,
      }),
    ).toMatchObject({ ok: true, operation: "check", attemptId: "check-attempt-1" });
    expect(
      decode({
        protocol: TASK_CLI_PROTOCOL,
        ok: false,
        operation: "check",
        error: { code: "check_indeterminate", message: "acknowledge the previous attempt" },
      }),
    ).toMatchObject({ ok: false, error: { code: "check_indeterminate" } });
    // A settled pass carries no finalization token: the CLI reports the pass
    // and never re-executes the command.
    expect(
      decode({
        ...successBase,
        operation: "check",
        accepted: true,
        attemptId: "check-attempt-1",
        checkId: "check:typecheck",
        attemptNumber: 0,
        command: "vp run typecheck",
        cwd: "/worktree",
        timeoutMs: 120_000,
        maxOutputBytes: 1_048_576,
        outcome: "settled-pass",
        finalizerToken: null,
        startingCommitSha: "deadbeef",
        startingStatus: "",
        taskRevision: 4,
      }),
    ).toMatchObject({ ok: true, outcome: "settled-pass", finalizerToken: null });
    expect(TASK_CLI_CHECK_BEGIN_PATH).toBe("/api/task-cli/v1/check/begin");
  });

  it("decodes check finalize success and failure envelopes", () => {
    const decode = Schema.decodeUnknownSync(TaskCliCheckFinalizeEnvelope);
    expect(
      decode({
        ...successBase,
        operation: "check",
        accepted: true,
        checkId: "check:typecheck",
        attemptId: "check-attempt-1",
        status: "pass",
        taskRevision: 4,
      }),
    ).toMatchObject({ ok: true, operation: "check", status: "pass" });
    expect(
      decode({
        protocol: TASK_CLI_PROTOCOL,
        ok: false,
        operation: "check",
        error: { code: "conflict", message: "replay" },
      }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(TASK_CLI_CHECK_FINALIZE_PATH).toBe("/api/task-cli/v1/check/finalize");
  });

  it("decodes amendment success and failure envelopes", () => {
    const decode = Schema.decodeUnknownSync(TaskCliAmendmentEnvelope);
    expect(
      decode({
        ...successBase,
        operation: "amendment",
        accepted: true,
        amendmentId: "amendment-1",
        taskRevision: 5,
      }),
    ).toMatchObject({ ok: true, operation: "amendment", amendmentId: "amendment-1" });
    expect(
      decode({
        protocol: TASK_CLI_PROTOCOL,
        ok: false,
        operation: "amendment",
        error: { code: "invalid_artifact", message: "bad plan diff" },
      }),
    ).toMatchObject({ ok: false, operation: "amendment" });
    expect(TASK_CLI_AMENDMENT_PATH).toBe("/api/task-cli/v1/amendment");
  });

  it("decodes bounded requests for progress, check begin, check finalize, and amendment", () => {
    expect(
      Schema.decodeUnknownSync(TaskCliProgressRequest)({
        target: "work-item",
        id: "work:implement",
        status: "completed",
        summary: "Done.",
      }),
    ).toEqual({
      target: "work-item",
      id: "work:implement",
      status: "completed",
      summary: "Done.",
    });
    expect(
      Schema.decodeUnknownSync(TaskCliCheckBeginRequest)({ checkId: "check:typecheck" }),
    ).toEqual({ checkId: "check:typecheck" });
    expect(
      Schema.decodeUnknownSync(TaskCliCheckFinalizeRequest)({
        finalizerToken: "opaque-token",
        exitCode: 0,
        status: "pass",
        output: "ok",
        timedOut: false,
        startingCommitSha: "deadbeef",
        endingCommitSha: "deadbeef",
        startingStatus: "",
        endingStatus: "",
      }),
    ).toMatchObject({ finalizerToken: "opaque-token", exitCode: 0, status: "pass" });
    expect(
      Schema.decodeUnknownSync(TaskCliAmendmentRequest)({
        phaseId: "phase:foundation",
        workItemId: "work:implement",
        triggeringCheckId: null,
        expected: "expected",
        found: "found",
        impact: "impact",
        proposedPlanMarkdown: "# Plan\n",
      }),
    ).toMatchObject({ phaseId: "phase:foundation", proposedPlanMarkdown: "# Plan\n" });
  });
});

describe("implementation command contract table", () => {
  it("declares one row per command with stable paths, codes, and exit semantics", () => {
    const rows = TASK_CLI_IMPLEMENTATION_COMMAND_CONTRACT.commands;
    expect(rows.map((row) => row.command)).toEqual([
      "katacode task context",
      "katacode task progress phase|work-item <id> --status <status> --summary <text>",
      "katacode task check run <check-id> (begin)",
      "katacode task check run <check-id> (finalize)",
      "katacode task amendment propose --phase <id> --work-item <id> --expected <text> --found <text> --impact <text> --input <file|->",
      "katacode task complete --summary <text> --artifact-file <file|-> (build stages omit --artifact-file)",
    ]);
    expect(rows.map((row) => row.path)).toEqual([
      TASK_CLI_CONTEXT_PATH,
      TASK_CLI_PROGRESS_PATH,
      TASK_CLI_CHECK_BEGIN_PATH,
      TASK_CLI_CHECK_FINALIZE_PATH,
      TASK_CLI_AMENDMENT_PATH,
      TASK_CLI_COMPLETE_PATH,
    ]);
    for (const row of rows) {
      expect(row.successExit).toBe(0);
      expect(row.failureExit).toBe(1);
      expect(row.successFields.length).toBeGreaterThan(0);
      expect(row.maxResponseChars).toBeLessThanOrEqual(TASK_CLI_RESPONSE_MAX_CHARS);
      expect(row.maxRequestChars).toBeGreaterThanOrEqual(0);
      expect(row.successSchema.length).toBeGreaterThan(0);
      for (const code of row.errorCodes) {
        expect(Schema.decodeUnknownSync(TaskCliErrorCode)(code)).toBe(code);
      }
    }
  });

  it("binds every successSchema to a decodable envelope exposing its successFields", () => {
    const schemasByName = new Map<string, Schema.Schema<any>>([
      ["TaskCliSuccessEnvelope", TaskCliContextEnvelope],
      ["TaskCliProgressSuccessEnvelope", TaskCliProgressEnvelope],
      ["TaskCliCheckBeginSuccessEnvelope", TaskCliCheckBeginEnvelope],
      ["TaskCliCheckFinalizeSuccessEnvelope", TaskCliCheckFinalizeEnvelope],
      ["TaskCliAmendmentSuccessEnvelope", TaskCliAmendmentEnvelope],
      ["TaskCliCompleteSuccessEnvelope", TaskCliCompleteEnvelope],
    ]);
    const envelopes: ReadonlyArray<{ readonly schemaName: string; readonly envelope: unknown }> = [
      {
        schemaName: "TaskCliSuccessEnvelope",
        envelope: {
          protocol: TASK_CLI_PROTOCOL,
          ok: true,
          operation: "context",
          context: {
            stage: "plan",
            occurrence: 0,
            brief: "b",
            feedback: null,
            artifacts: [],
          },
          commands: TASK_CLI_PLANNING_COMMANDS,
        },
      },
      {
        schemaName: "TaskCliProgressSuccessEnvelope",
        envelope: {
          protocol: TASK_CLI_PROTOCOL,
          ok: true,
          operation: "progress",
          accepted: true,
          phaseId: "phase:1",
          workItemId: null,
          status: "running",
          taskRevision: 3,
        },
      },
      {
        schemaName: "TaskCliCheckBeginSuccessEnvelope",
        envelope: {
          protocol: TASK_CLI_PROTOCOL,
          ok: true,
          operation: "check",
          accepted: true,
          attemptId: "check-attempt-1",
          checkId: "check:typecheck",
          attemptNumber: 0,
          command: "vp run typecheck",
          cwd: "/tmp",
          timeoutMs: 120_000,
          maxOutputBytes: 1_048_576,
          outcome: "spawn",
          finalizerToken: "opaque-token",
          startingCommitSha: "0123456789abcdef",
          startingStatus: "",
          taskRevision: 3,
        },
      },
      {
        schemaName: "TaskCliCheckFinalizeSuccessEnvelope",
        envelope: {
          protocol: TASK_CLI_PROTOCOL,
          ok: true,
          operation: "check",
          accepted: true,
          checkId: "check:typecheck",
          attemptId: "check-attempt-1",
          status: "pass",
          taskRevision: 4,
        },
      },
      {
        schemaName: "TaskCliAmendmentSuccessEnvelope",
        envelope: {
          protocol: TASK_CLI_PROTOCOL,
          ok: true,
          operation: "amendment",
          accepted: true,
          amendmentId: "amendment-1",
          taskRevision: 5,
        },
      },
      {
        schemaName: "TaskCliCompleteSuccessEnvelope",
        envelope: {
          protocol: TASK_CLI_PROTOCOL,
          ok: true,
          operation: "complete",
          completion: {
            accepted: true,
            stage: "build",
            occurrence: 1,
            proposalId: "proposal-build-1",
            providerTurnId: "turn-9",
          },
        },
      },
    ];
    const byName = new Map(envelopes.map((entry) => [entry.schemaName, entry.envelope]));
    for (const row of TASK_CLI_IMPLEMENTATION_COMMAND_CONTRACT.commands) {
      const envelope = byName.get(row.successSchema);
      const schema = schemasByName.get(row.successSchema);
      expect(envelope, `successSchema '${row.successSchema}' must have a fixture`).toBeDefined();
      expect(schema, `successSchema '${row.successSchema}' must map to a schema`).toBeDefined();
      const decoded = Schema.decodeUnknownSync(schema! as never)(envelope);
      const scope =
        row.successSchema === "TaskCliCompleteSuccessEnvelope"
          ? (decoded as { readonly completion: unknown }).completion
          : decoded;
      for (const field of row.successFields) {
        expect(scope, `success schema '${row.successSchema}'`).toHaveProperty(field);
      }
    }
  });

  it("keeps the planning-completion contract table intact", () => {
    expect(TASK_CLI_PLANNING_COMPLETION_CONTRACT.path).toBe(TASK_CLI_COMPLETE_PATH);
    expect(TASK_CLI_PLANNING_COMPLETION_CONTRACT.successFields).toContain("accepted");
  });
});

describe("planning-completion contract table", () => {
  const decodeComplete = Schema.decodeUnknownSync(TaskCliCompleteEnvelope);
  const encodeComplete = Schema.encodeSync(TaskCliCompleteEnvelope);
  const decodeRequest = Schema.decodeUnknownSync(TaskCliCompleteRequest);

  const success = {
    protocol: TASK_CLI_PROTOCOL,
    ok: true as const,
    operation: "complete" as const,
    completion: {
      accepted: true as const,
      stage: "questions" as const,
      occurrence: 0,
      proposalId: "proposal-task-0-turn-1",
      providerTurnId: "turn-1",
    },
  };

  it("defines the success schema, bounds, codes, and exit semantics", () => {
    expect(TASK_CLI_PLANNING_COMPLETION_CONTRACT).toEqual({
      protocol: "task-cli@1",
      path: TASK_CLI_COMPLETE_PATH,
      summaryMaxChars: TASK_CLI_SUMMARY_MAX_CHARS,
      artifactMaxChars: TASK_CLI_ARTIFACT_MAX_CHARS,
      responseMaxChars: TASK_CLI_RESPONSE_MAX_CHARS,
      successExit: 0,
      failureExit: 1,
      successFields: ["accepted", "stage", "occurrence", "proposalId", "providerTurnId"],
      errorCodes: TaskCliErrorCode.literals,
    });
    expect(TASK_CLI_COMPLETE_PATH).toBe("/api/task-cli/v1/complete");
    expect(TASK_CLI_SUMMARY_MAX_CHARS).toBe(4_000);
    expect(TASK_CLI_ARTIFACT_MAX_CHARS).toBe(100_000);
    expect(decodeComplete(success)).toMatchObject({ ok: true, operation: "complete" });
    expect(JSON.stringify(encodeComplete(success)).length).toBeLessThanOrEqual(
      TASK_CLI_RESPONSE_MAX_CHARS,
    );
  });

  it.each(TaskCliErrorCode.literals)(
    "decodes stable error code %s with a nonzero failure exit",
    (code) => {
      const envelope = decodeComplete({
        protocol: TASK_CLI_PROTOCOL,
        ok: false,
        operation: "complete",
        error: { code, message: `${code} message` },
      });
      expect(envelope).toMatchObject({ ok: false, operation: "complete", error: { code } });
      expect(TASK_CLI_PLANNING_COMPLETION_CONTRACT.failureExit).toBe(1);
    },
  );

  it("accepts a bounded complete request and rejects identity fields as the request schema", () => {
    expect(
      decodeRequest({
        summary: "Clarify complete.",
        markdown: "# Clarify\n\nThe scope is clear.\n",
      }),
    ).toEqual({
      summary: "Clarify complete.",
      markdown: "# Clarify\n\nThe scope is clear.\n",
    });
    expect(TASK_CLI_PLANNING_COMMANDS.complete).toContain("--artifact-file");
  });
});
