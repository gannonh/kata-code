import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SeedWorkspaceInput {
  readonly name: string;
  readonly root: string;
  readonly files: Record<string, string>;
}

export async function seedWorkspace(input: SeedWorkspaceInput): Promise<string> {
  const workspaceRoot = join(input.root, input.name);
  await mkdir(workspaceRoot, { recursive: true });

  for (const [relativePath, contents] of Object.entries(input.files)) {
    const absolutePath = join(workspaceRoot, relativePath);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");
  }

  return workspaceRoot;
}
