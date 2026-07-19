import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { applyE2ERepoEnv } from "./loadEnv.ts";

function makeRepoWithEnv(files: { readonly env?: string; readonly local?: string }): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "katacode-e2e-loadenv-"));
  mkdirSync(repoRoot, { recursive: true });
  if (files.env !== undefined) {
    writeFileSync(join(repoRoot, ".env"), files.env);
  }
  if (files.local !== undefined) {
    writeFileSync(join(repoRoot, ".env.local"), files.local);
  }
  return repoRoot;
}

describe("applyE2ERepoEnv", () => {
  it("lets .env values win over ambient shell exports for the same key", () => {
    const repoRoot = makeRepoWithEnv({
      env: [
        "KATACODE_E2E_ENABLE_PI=0",
        "KATACODE_E2E_PI_AGENT_DIR=/file/agent",
        "KATACODE_E2E_PI_MODEL=openrouter/free",
        "KATACODE_E2E_AGENT_MODEL=claude-sonnet-4-6",
      ].join("\n"),
    });
    const targetEnv: NodeJS.ProcessEnv = {
      KATACODE_E2E_ENABLE_PI: "1",
      KATACODE_E2E_PI_AGENT_DIR: "/ambient/agent",
      KATACODE_E2E_PI_MODEL: "anthropic/claude-sonnet-4-6",
      KATACODE_E2E_AGENT_MODEL: "stale-shell-model",
      SHELL_ONLY: "keep-me",
    };

    applyE2ERepoEnv(targetEnv, { repoRoot });

    expect(targetEnv.KATACODE_E2E_ENABLE_PI).toBe("0");
    expect(targetEnv.KATACODE_E2E_PI_AGENT_DIR).toBe("/file/agent");
    expect(targetEnv.KATACODE_E2E_PI_MODEL).toBe("openrouter/free");
    expect(targetEnv.KATACODE_E2E_AGENT_MODEL).toBe("claude-sonnet-4-6");
    expect(targetEnv.SHELL_ONLY).toBe("keep-me");
  });

  it("preserves only ambient Pi gate values during update verification", () => {
    const repoRoot = makeRepoWithEnv({
      env: [
        "KATACODE_E2E_ENABLE_PI=0",
        "KATACODE_E2E_PI_AGENT_DIR=/file/agent",
        "KATACODE_E2E_PI_MODEL=file/model",
        "UNRELATED_VALUE=from-file",
      ].join("\n"),
    });
    const targetEnv: NodeJS.ProcessEnv = {
      KATACODE_E2E_PI_UPDATE_VERIFICATION: "1",
      KATACODE_E2E_ENABLE_PI: "1",
      KATACODE_E2E_PI_AGENT_DIR: "/ambient/agent",
      KATACODE_E2E_PI_MODEL: "ambient/model",
      UNRELATED_VALUE: "from-ambient",
    };

    applyE2ERepoEnv(targetEnv, { repoRoot });

    expect(targetEnv).toMatchObject({
      KATACODE_E2E_ENABLE_PI: "1",
      KATACODE_E2E_PI_AGENT_DIR: "/ambient/agent",
      KATACODE_E2E_PI_MODEL: "ambient/model",
      UNRELATED_VALUE: "from-file",
    });
  });

  it("lets .env.local override .env while still beating the shell", () => {
    const repoRoot = makeRepoWithEnv({
      env: "KATACODE_E2E_PI_MODEL=from-env\n",
      local: "KATACODE_E2E_PI_MODEL=from-local\n",
    });
    const targetEnv: NodeJS.ProcessEnv = {
      KATACODE_E2E_PI_MODEL: "from-shell",
    };

    applyE2ERepoEnv(targetEnv, { repoRoot });

    expect(targetEnv.KATACODE_E2E_PI_MODEL).toBe("from-local");
  });
});
