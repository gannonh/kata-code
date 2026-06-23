import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { join } from "node:path";

/* oxlint-disable kata-code/no-global-process-runtime -- E2E harness runs outside Effect runtime; platform gate for pkill. */

export function cleanupStaleDesktopDevApps(repoRoot: string): void {
  if (platform() === "win32") {
    return;
  }

  const desktopDir = join(repoRoot, "apps/desktop");
  spawnSync("pkill", ["-f", `--katacode-dev-root=${desktopDir}`], { stdio: "ignore" });
}
