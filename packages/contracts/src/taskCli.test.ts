import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  TASK_CLI_ARTIFACT_MAX_CHARS,
  TASK_CLI_COMPLETE_PATH,
  TASK_CLI_CONTEXT_PATH,
  TASK_CLI_PLANNING_COMMANDS,
  TASK_CLI_PLANNING_COMPLETION_CONTRACT,
  TASK_CLI_PROTOCOL,
  TASK_CLI_RESPONSE_MAX_CHARS,
  TASK_CLI_SUMMARY_MAX_CHARS,
  TaskCliCompleteEnvelope,
  TaskCliCompleteRequest,
  TaskCliContextEnvelope,
  TaskCliErrorCode,
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
    expect(() => decode("task_internal_command")).toThrow();
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
