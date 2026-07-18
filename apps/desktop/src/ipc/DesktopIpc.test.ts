import { describe, expect, it } from "vite-plus/test";

import { toIpcFailure } from "./DesktopIpc.ts";

describe("toIpcFailure", () => {
  it("unwraps PreviewManagerError causes so agents see the automation message", () => {
    const cause = new Error("No element matches locator role=button[name*='search'].");
    cause.name = "PreviewAutomationExecutionError";
    const wrapped = {
      _tag: "PreviewManagerError",
      operation: "automationClick",
      cause,
      message: "Desktop preview operation failed: automationClick",
    };

    const failure = toIpcFailure(wrapped);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.name).toBe("PreviewAutomationExecutionError");
    expect(failure.message).toBe("No element matches locator role=button[name*='search'].");
  });

  it("preserves timeout identity for wait-for failures", () => {
    const cause = new Error("Preview condition did not match within 30000ms.");
    cause.name = "PreviewAutomationTimeoutError";
    const failure = toIpcFailure({
      _tag: "PreviewManagerError",
      operation: "automationWaitFor",
      cause,
    });
    expect(failure.name).toBe("PreviewAutomationTimeoutError");
    expect(failure.message).toBe("Preview condition did not match within 30000ms.");
  });

  it("passes through plain errors unchanged", () => {
    const error = new Error("boom");
    error.name = "Error";
    expect(toIpcFailure(error)).toBe(error);
  });
});
