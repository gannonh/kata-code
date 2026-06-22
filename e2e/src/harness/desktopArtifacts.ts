import { access } from "node:fs/promises";
import { join } from "node:path";

export async function assertDesktopBuildArtifacts(repoRoot: string): Promise<void> {
  const mainBundle = join(repoRoot, "apps/desktop/dist-electron/main.cjs");
  try {
    await access(mainBundle);
  } catch {
    throw new Error(
      `desktop-dev launch: missing ${mainBundle}. Run "vp run --filter @kata-sh/code-desktop ensure:electron" and build desktop before E2E.`,
    );
  }
}
