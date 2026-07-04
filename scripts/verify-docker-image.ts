/**
 * Phase 3a Dockerfile build verification (AC-3a.1/3a.2/3a.11).
 *
 * Runs the built `katacode:local` image and asserts the provider CLIs
 * (`codex`, `agent`, `grok`, `claude`, `opencode`) and `git` resolve on PATH,
 * that `SHELL=/bin/sh` is set, and that `/bin/sh` exists in the runtime stage.
 * Fails loud (exit 1) if any check fails so CI catches a regression in the
 * Dockerfile runtime stage.
 *
 * Usage: `pnpm run verify:docker-image` (after `pnpm run build:docker-image`).
 */
// @effect-diagnostics nodeBuiltinImport:off - imperative docker CLI wrapper, not an Effect service.
import { spawn } from "node:child_process";

const IMAGE = process.env.KATACODE_DOCKER_IMAGE ?? "katacode:local";

const REQUIRED_BINARIES = ["codex", "agent", "grok", "claude", "opencode", "git"] as const;

/** Run the probe inside the image and reject with combined stderr on failure. */
function runDocker(probe: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["run", "--rm", "--entrypoint", "sh", IMAGE, "-c", probe], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout?.pipe(process.stdout);
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      process.stderr.write(chunk);
    });
    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker run exited with code ${code}\n${stderr}`));
    });
  });
}

async function main(): Promise<void> {
  const probe = [
    "set -eux",
    // Each required binary must resolve on PATH.
    ...REQUIRED_BINARIES.map((binary) => `command -v ${binary}`),
    // SHELL env must be /bin/sh (AC-3a.2).
    'test "$SHELL" = "/bin/sh"',
    // /bin/sh must exist in the runtime stage (AC-3a.2/3a.3).
    "test -e /bin/sh",
  ].join(" && ");

  try {
    await runDocker(probe);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `verify-docker-image: ${IMAGE} failed the Phase 3a runtime checks.\n${message}\n` +
        `Rebuild with \`pnpm run build:docker-image\` and re-run \`pnpm run verify:docker-image\`.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `verify-docker-image: ${IMAGE} OK — provider CLIs on PATH, SHELL=/bin/sh, /bin/sh present.\n`,
  );
}

void main();
