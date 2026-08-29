import { describe, expect, it } from "vite-plus/test";

import { parseFixturePath } from "./mobile-markdown-image-race-responder.js";

describe("mobile Markdown image race responder paths", () => {
  it("parses image, wait, and release paths", () => {
    expect(parseFixturePath("/runs/run-1/late-success/a.png")).toEqual({
      kind: "image",
      runId: "run-1",
      raceCase: "late-success",
      source: "a",
    });
    expect(parseFixturePath("/runs/run-1/late-error/wait/b")).toEqual({
      kind: "wait",
      runId: "run-1",
      raceCase: "late-error",
      source: "b",
    });
    expect(parseFixturePath("/runs/run-1/late-error/release/a/error")).toEqual({
      kind: "release",
      runId: "run-1",
      raceCase: "late-error",
      source: "a",
      outcome: "error",
    });
  });

  it.each([
    "/runs//late-success/a.png",
    "/runs/run-1/unknown/a.png",
    "/runs/run-1/late-success/c.png",
    "/runs/run-1/late-error/release/a/success",
    "/runs/run-1/late-success/release/a/error",
  ])("rejects unsupported path %s", (path) => {
    expect(parseFixturePath(path)).toBeNull();
  });
});
