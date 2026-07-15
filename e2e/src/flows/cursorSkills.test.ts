import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { readCursorSkillsConfig } from "./cursorSkills.ts";

const ENV_KEYS = [
  "KATACODE_E2E_ENABLE_CURSOR",
  "KATACODE_E2E_CURSOR_MODEL",
  "KATACODE_E2E_CURSOR_API_KEY",
  "KATACODE_E2E_CURSOR_BINARY_PATH",
] as const;

const originalEnv = new Map<string, string | undefined>();

describe("readCursorSkillsConfig", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv.set(key, process.env[key]);
    }
    process.env.KATACODE_E2E_ENABLE_CURSOR = "1";
    process.env.KATACODE_E2E_CURSOR_MODEL = "composer-2.5";
    process.env.KATACODE_E2E_CURSOR_API_KEY = "cursor-test-key";
    delete process.env.KATACODE_E2E_CURSOR_BINARY_PATH;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    originalEnv.clear();
  });

  it("requires an explicit Cursor binary so another `agent` CLI cannot be selected", () => {
    expect(readCursorSkillsConfig()).toEqual({
      ok: false,
      missing: ["KATACODE_E2E_CURSOR_BINARY_PATH"],
    });
  });

  it("returns the explicitly configured Cursor binary", () => {
    process.env.KATACODE_E2E_CURSOR_BINARY_PATH = "cursor-agent";

    expect(readCursorSkillsConfig()).toEqual({
      ok: true,
      config: {
        model: "composer-2.5",
        binaryPath: "cursor-agent",
      },
    });
  });
});
