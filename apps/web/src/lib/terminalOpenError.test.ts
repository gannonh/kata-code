import { describe, expect, it } from "vite-plus/test";

import { formatTerminalOpenErrorMessage } from "./terminalOpenError";

describe("formatTerminalOpenErrorMessage (AC-3a.4)", () => {
  it("uses the Error message when present", () => {
    expect(formatTerminalOpenErrorMessage(new Error("spawn ENOENT"))).toBe("spawn ENOENT");
  });

  it("falls back to a generic message for non-Error rejections", () => {
    expect(formatTerminalOpenErrorMessage("boom")).toBe("Failed to open terminal.");
    expect(formatTerminalOpenErrorMessage(null)).toBe("Failed to open terminal.");
    expect(formatTerminalOpenErrorMessage(undefined)).toBe("Failed to open terminal.");
  });
});
