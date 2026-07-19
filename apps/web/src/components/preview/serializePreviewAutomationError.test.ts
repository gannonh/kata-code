import { describe, expect, it } from "vite-plus/test";

import { serializePreviewAutomationError } from "./PreviewAutomationOwner.tsx";

describe("serializePreviewAutomationError", () => {
  it("unwraps PreviewManagerError wrappers from desktop IPC", () => {
    const cause = new Error("No element matches locator role=button[name*='search'].");
    cause.name = "PreviewAutomationExecutionError";
    const wrapped = new Error("Desktop preview operation failed: automationClick");
    wrapped.name = "PreviewManagerError";
    (wrapped as Error & { cause: Error }).cause = cause;

    expect(serializePreviewAutomationError(wrapped)).toEqual({
      _tag: "PreviewAutomationExecutionError",
      message: "No element matches locator role=button[name*='search'].",
    });
  });

  it("keeps typed automation timeouts", () => {
    const error = new Error("Preview condition did not match within 30000ms.");
    error.name = "PreviewAutomationTimeoutError";
    expect(serializePreviewAutomationError(error)).toEqual({
      _tag: "PreviewAutomationTimeoutError",
      message: "Preview condition did not match within 30000ms.",
    });
  });
});
