import { assert, describe, it } from "@effect/vitest";

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  AUTH_CALLBACK_RETRY_DELAYS_MS,
  createDevelopmentLauncherScript,
  createDevelopmentLauncherShim,
  resolveDevelopmentProtocolCallbackUrl,
} from "./electron-launcher.mjs";

function runLauncherScript(args) {
  const tempDir = mkdtempSync(join(tmpdir(), "kata-electron-launcher-test-"));
  const scriptPath = join(tempDir, "Electron");

  try {
    writeFileSync(
      scriptPath,
      createDevelopmentLauncherScript({
        envEntries: [],
        electronBinaryPath: "/bin/echo",
        shimEntryPath: "/tmp/katacode-dev-callback.cjs",
      }),
    );
    chmodSync(scriptPath, 0o755);
    return spawnSync(scriptPath, args, { encoding: "utf8" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("electron development launcher", () => {
  it("derives the auth callback port from KATACODE_PORT", () => {
    const previousPort = process.env.KATACODE_PORT;
    process.env.KATACODE_PORT = "14000";
    try {
      assert.equal(resolveDevelopmentProtocolCallbackUrl(), "http://127.0.0.1:14001/auth/callback");
    } finally {
      if (previousPort === undefined) {
        delete process.env.KATACODE_PORT;
      } else {
        process.env.KATACODE_PORT = previousPort;
      }
    }
  });

  it("keeps auth callback retry delays aligned between shell and shim", () => {
    const shim = createDevelopmentLauncherShim();
    const script = createDevelopmentLauncherScript({
      envEntries: [],
      electronBinaryPath: "/bin/echo",
      shimEntryPath: "/tmp/katacode-dev-callback.cjs",
    });

    assert.include(shim, JSON.stringify(AUTH_CALLBACK_RETRY_DELAYS_MS));
    assert.include(
      script,
      AUTH_CALLBACK_RETRY_DELAYS_MS.filter((ms) => ms > 0)
        .map((ms) => ms / 1000)
        .join(" "),
    );
  });

  it("includes a shim that catches macOS open-url callbacks without loading main", () => {
    const shim = createDevelopmentLauncherShim();

    assert.include(shim, 'app.on("open-url"');
    assert.notInclude(shim, "KATACODE_DESKTOP_DEV_MAIN_ENTRY");
    assert.notInclude(shim, "require(mainEntryPath)");
  });

  it("does not start Electron when auth callback forwarding is unavailable", () => {
    const result = runLauncherScript([
      "katacode-dev://auth/callback?katacode_state=state&rotating_token_nonce=nonce",
    ]);

    assert.equal(result.status, 1);
    assert.notInclude(result.stdout, "/tmp/katacode-dev-callback.cjs");
    assert.include(result.stderr, "Kata Code dev auth callback URL is not configured.");
  });

  it("starts the callback shim for regular launcher invocations", () => {
    const result = runLauncherScript(["--opened-from-dock"]);

    assert.equal(result.status, 0);
    assert.include(result.stdout, "/tmp/katacode-dev-callback.cjs --opened-from-dock");
  });
});
