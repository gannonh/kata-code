import { describe, expect, it } from "@effect/vitest";

import { inspectTaskCliInvocationArgs } from "./task.ts";

describe("inspectTaskCliInvocationArgs", () => {
  it("accepts the Task context verb as the first positional argument", () => {
    expect(inspectTaskCliInvocationArgs(["task", "context"])).toBeUndefined();
    expect(inspectTaskCliInvocationArgs(["--no-browser", "task", "context"])).toBeUndefined();
  });

  it("does not treat `task` as the verb when it is a flag value or later positional", () => {
    expect(inspectTaskCliInvocationArgs(["start", "--project", "task"])).toBeUndefined();
    expect(inspectTaskCliInvocationArgs(["--base-dir", "task", "start"])).toBeUndefined();
    expect(inspectTaskCliInvocationArgs(["start", "task"])).toBeUndefined();
  });

  it("rejects a missing or unknown Task verb", () => {
    expect(inspectTaskCliInvocationArgs(["task"])).toBe(
      "Specify a Task command. The available command is `katacode task context`.",
    );
    expect(inspectTaskCliInvocationArgs(["task", "complete"])).toContain("Unknown Task command");
  });

  it("rejects identity flags on the context command", () => {
    expect(inspectTaskCliInvocationArgs(["task", "context", "--task-id", "forged-task"])).toContain(
      "identity",
    );
  });
});
