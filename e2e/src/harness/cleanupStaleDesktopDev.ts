import { spawnSync } from "node:child_process";
import { join } from "node:path";

export function cleanupStaleDesktopDevApps(repoRoot: string): void {
  if (process.platform === "win32") {
    return;
  }

  const desktopDir = join(repoRoot, "apps/desktop");
  spawnSync("pkill", ["-f", `--katacode-dev-root=${desktopDir}`], { stdio: "ignore" });
}
