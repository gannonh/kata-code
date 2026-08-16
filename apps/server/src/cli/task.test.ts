import { describe, expect, it } from "@effect/vitest";

import { inspectTaskCliInvocationArgs } from "./task.ts";

describe("inspectTaskCliInvocationArgs", () => {
  it("accepts the Task context, complete, progress, check, and amendment verbs", () => {
    expect(inspectTaskCliInvocationArgs(["task", "context"])).toBeUndefined();
    expect(inspectTaskCliInvocationArgs(["--no-browser", "task", "context"])).toBeUndefined();
    expect(
      inspectTaskCliInvocationArgs([
        "task",
        "complete",
        "--summary",
        "Done.",
        "--artifact-file",
        "-",
      ]),
    ).toBeUndefined();
    expect(
      inspectTaskCliInvocationArgs([
        "task",
        "progress",
        "phase",
        "phase:a",
        "--status",
        "running",
        "--summary",
        "s",
      ]),
    ).toBeUndefined();
    expect(inspectTaskCliInvocationArgs(["task", "check", "run", "check:a"])).toBeUndefined();
    expect(
      inspectTaskCliInvocationArgs([
        "task",
        "amendment",
        "propose",
        "--phase",
        "p",
        "--work-item",
        "w",
        "--expected",
        "e",
        "--found",
        "f",
        "--impact",
        "i",
        "--input",
        "-",
      ]),
    ).toBeUndefined();
  });

  it("does not treat `task` as the verb when it is a flag value or later positional", () => {
    expect(inspectTaskCliInvocationArgs(["start", "--project", "task"])).toBeUndefined();
    expect(inspectTaskCliInvocationArgs(["--base-dir", "task", "start"])).toBeUndefined();
    expect(inspectTaskCliInvocationArgs(["start", "task"])).toBeUndefined();
  });

  it("rejects a missing or unknown Task verb", () => {
    expect(inspectTaskCliInvocationArgs(["task"])).toEqual({
      operation: "context",
      message:
        "Specify a Task command. The available commands are `katacode task context`, `katacode task progress`, `katacode task check run`, `katacode task amendment propose`, and `katacode task complete`.",
    });
    expect(inspectTaskCliInvocationArgs(["task", "explain"])).toEqual({
      operation: "context",
      message:
        "Unknown Task command `explain`. The available commands are `katacode task context`, `katacode task progress`, `katacode task check run`, `katacode task amendment propose`, and `katacode task complete`.",
    });
  });

  it("rejects identity flags on context and complete commands", () => {
    expect(inspectTaskCliInvocationArgs(["task", "context", "--task-id", "forged-task"])).toEqual({
      operation: "context",
      message: "Task CLI requests accept no identity flags or identity payload fields.",
    });
    expect(
      inspectTaskCliInvocationArgs([
        "task",
        "complete",
        "--summary",
        "Done.",
        "--artifact-file",
        "-",
        "--thread-id",
        "forged-thread",
      ]),
    ).toEqual({
      operation: "complete",
      message: "Task CLI requests accept no identity flags or identity payload fields.",
    });
  });
});
