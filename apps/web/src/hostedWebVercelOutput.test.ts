// @effect-diagnostics nodeBuiltinImport:off - Reads repo-root Vercel config and Vite outDir.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { config as webVercelConfig } from "../vercel.ts";

const webRoot = NodePath.resolve(import.meta.dirname, "..");
const repoRoot = NodePath.resolve(webRoot, "../..");

const viteConfigSource = NodeFS.readFileSync(NodePath.join(webRoot, "vite.config.ts"), "utf8");
const viteOutDirMatch = viteConfigSource.match(/outDir:\s*"([^"]+)"/);

describe("hosted web Vercel output", () => {
  it("matches the Vite emit directory, not Vercel's default public folder", () => {
    expect(viteOutDirMatch?.[1]).toBe("dist");
    expect(webVercelConfig.outputDirectory).toBe("dist");
  });

  it("names apps/web/dist from the repo-root config that Release deploy_web uploads", () => {
    const rootConfigPath = NodePath.join(repoRoot, "vercel.ts");
    expect(
      NodeFS.existsSync(rootConfigPath),
      "Release deploy_web runs `vercel deploy` from the monorepo root, so Vercel reads a root vercel.ts",
    ).toBe(true);

    const rootConfigSource = NodeFS.readFileSync(rootConfigPath, "utf8");
    expect(rootConfigSource).toMatch(/outputDirectory:\s*"apps\/web\/dist"/);
    expect(rootConfigSource).toContain("vp run --filter @kata-sh/code-web build");
    expect(rootConfigSource).not.toContain("filter './apps/*'");
  });
});
