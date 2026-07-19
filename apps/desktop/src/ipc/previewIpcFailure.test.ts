import { describe, expect, it } from "vite-plus/test";

import { toPreviewIpcFailure } from "./previewIpcFailure.ts";

describe("toPreviewIpcFailure", () => {
  it("unwraps PreviewManagerError causes so agents see the automation message", () => {
    const cause = new Error("No element matches locator role=button[name*='search'].");
    cause.name = "PreviewAutomationExecutionError";
    const wrapped = {
      _tag: "PreviewManagerError",
      operation: "automationClick",
      cause,
      message: "Desktop preview operation failed: automationClick",
    };

    const failure = toPreviewIpcFailure(wrapped);
    expect(failure).toBeInstanceOf(Error);
    const error = failure as Error;
    expect(error.name).toBe("PreviewAutomationExecutionError");
    expect(error.message).toBe("No element matches locator role=button[name*='search'].");
  });

  it("preserves timeout identity for wait-for failures", () => {
    const cause = new Error("Preview condition did not match within 30000ms.");
    cause.name = "PreviewAutomationTimeoutError";
    const failure = toPreviewIpcFailure({
      _tag: "PreviewManagerError",
      operation: "automationWaitFor",
      cause,
    });
    expect(failure).toBeInstanceOf(Error);
    const error = failure as Error;
    expect(error.name).toBe("PreviewAutomationTimeoutError");
    expect(error.message).toBe("Preview condition did not match within 30000ms.");
  });

  it("passes through plain errors unchanged", () => {
    const error = new Error("boom");
    error.name = "Error";
    expect(toPreviewIpcFailure(error)).toBe(error);
  });
});
