import { describe, expect, it } from "vitest";

import { resolveAppProject } from "./project.ts";

describe("resolveAppProject", () => {
  it("exposes a portable web target for shared specs", () => {
    expect(
      resolveAppProject("web-dev", {
        appTarget: "web",
        launchTarget: "dev",
      }),
    ).toEqual({ appTarget: "web", launchTarget: "dev" });
  });

  it("preserves desktop release as a native target", () => {
    expect(
      resolveAppProject("desktop-release", {
        appTarget: "desktop",
        launchTarget: "release",
      }),
    ).toEqual({ appTarget: "desktop", launchTarget: "release" });
  });

  it("fails loudly when target metadata is missing", () => {
    expect(() => resolveAppProject("unknown", {})).toThrow(
      'E2E project "unknown" must define metadata.appTarget as "web" or "desktop"',
    );
  });
});
