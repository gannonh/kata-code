import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  TASK_CLI_CONTEXT_PATH,
  TASK_CLI_PROTOCOL,
  TaskCliContextEnvelope,
  TaskCliErrorCode,
} from "./taskCli.ts";

describe("Task CLI contracts", () => {
  it("decodes a versioned context success envelope", () => {
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
      }),
    ).toMatchObject({ protocol: "task-cli@1", ok: true, operation: "context" });
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
    expect(() => decode("task_internal_command")).toThrow();
  });
});
