import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { PreviewAutomationRequest } from "./previewAutomation.ts";

const decodePreviewAutomationRequest = Schema.decodeUnknownSync(PreviewAutomationRequest);

function decodeSync(input: unknown): Schema.Schema.Type<typeof PreviewAutomationRequest> {
  return decodePreviewAutomationRequest(input);
}

function decodes(input: unknown): boolean {
  try {
    decodePreviewAutomationRequest(input);
    return true;
  } catch {
    return false;
  }
}

const base = {
  requestId: "preview-1",
  threadId: "thread-1",
  timeoutMs: 15_000,
} as const;

describe("PreviewAutomationRequest", () => {
  it("decodes status with empty optional input", () => {
    expect(decodeSync({ ...base, operation: "status", input: {} })).toMatchObject({
      operation: "status",
      input: {},
    });
    expect(decodeSync({ ...base, operation: "status" })).toMatchObject({
      operation: "status",
    });
  });

  it("decodes open with typed input", () => {
    const decoded = decodeSync({
      ...base,
      operation: "open",
      input: { url: "https://example.com", show: true },
    });
    expect(decoded.operation).toBe("open");
    if (decoded.operation !== "open") return;
    expect(decoded.input.url).toBe("https://example.com");
    expect(decoded.input.show).toBe(true);
  });

  it("decodes click with typed coordinate input", () => {
    const decoded = decodeSync({
      ...base,
      operation: "click",
      input: { x: 10, y: 20 },
    });
    expect(decoded.operation).toBe("click");
    if (decoded.operation !== "click") return;
    expect(decoded.input).toEqual({ x: 10, y: 20 });
  });

  it("rejects click input that fails the typed filter", () => {
    expect(
      decodes({
        ...base,
        operation: "click",
        input: { x: 10 },
      }),
    ).toBe(false);
  });

  it("rejects navigate without url or target", () => {
    expect(
      decodes({
        ...base,
        operation: "navigate",
        input: {},
      }),
    ).toBe(false);
  });

  it("rejects unknown operations", () => {
    expect(
      decodes({
        ...base,
        operation: "unknown",
        input: {},
      }),
    ).toBe(false);
  });
});
