import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { type MobileE2ERunContext, registerCleanup } from "./isolatedRun.ts";

const DEFAULT_FILES: Record<string, string> = {
  "package.json": `${JSON.stringify({ name: "mobile-e2e-seeded", scripts: { test: "echo ok" } }, null, 2)}\n`,
  "README.md": "# Mobile E2E seeded workspace\n",
};

/**
 * Create a real on-disk workspace the app can open through the normal flow.
 * Returns the absolute path; the directory is removed during run cleanup.
 */
export async function seedWorkspace(
  context: MobileE2ERunContext,
  name: string,
  files: Record<string, string> = DEFAULT_FILES,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `katacode-mobile-e2e-ws-${name}-`));
  for (const [relativePath, contents] of Object.entries(files)) {
    // Nested relative paths (src/index.ts, .vscode/settings.json) need their
    // parent directories created before the file write.
    const absolute = join(root, relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, "utf8");
  }
  registerCleanup(context, async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
