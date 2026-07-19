import { describe, expect, it } from "vite-plus/test";

import { toIpcFailure } from "./DesktopIpc.ts";

describe("toIpcFailure", () => {
  it("passes through plain errors unchanged", () => {
    const error = new Error("boom");
    error.name = "Error";
    expect(toIpcFailure(error)).toBe(error);
  });

  it("wraps non-Error values", () => {
    const failure = toIpcFailure("boom");
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe("boom");
  });
});
