import { describe, expect, it } from "vitest";

import { buildDevRunnerArgs } from "./devStack.ts";

describe("buildDevRunnerArgs", () => {
  it("starts the Vite dev server without auto-spawning Electron", () => {
    expect(
      buildDevRunnerArgs({
        katacodeHome: "/tmp/katacode-e2e-home",
        serverPort: 14284,
        webPort: 6244,
      }),
    ).toEqual([
      "scripts/dev-runner.ts",
      "dev:web",
      "--home-dir",
      "/tmp/katacode-e2e-home",
      "--no-browser",
      "--port",
      "14284",
      "--dev-url",
      "http://127.0.0.1:6244",
    ]);
  });
});
