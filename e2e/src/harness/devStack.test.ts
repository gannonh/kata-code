import { describe, expect, it } from "vitest";

import { buildDevRunnerArgs, buildWebDevRunnerArgs, parsePairingUrl } from "./devStack.ts";

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

describe("buildWebDevRunnerArgs", () => {
  it("starts an isolated full web stack without opening a browser", () => {
    expect(
      buildWebDevRunnerArgs({
        katacodeHome: "/tmp/katacode-e2e-home",
        serverPort: 14284,
        webPort: 6244,
      }),
    ).toEqual([
      "scripts/dev-runner.ts",
      "dev",
      "--home-dir",
      "/tmp/katacode-e2e-home",
      "--no-browser",
      "--port",
      "14284",
      "--dev-url",
      "http://localhost:6244",
    ]);
  });
});

describe("parsePairingUrl", () => {
  it("extracts the user-facing pairing URL from server output", () => {
    expect(parsePairingUrl("Pairing URL: http://127.0.0.1:6244/#token=secret\n")).toBe(
      "http://127.0.0.1:6244/#token=secret",
    );
  });

  it("extracts the structured logger pairing URL", () => {
    expect(parsePairingUrl("  pairingUrl: http://127.0.0.1:6244/pair#token=secret\n")).toBe(
      "http://127.0.0.1:6244/pair#token=secret",
    );
  });
});
