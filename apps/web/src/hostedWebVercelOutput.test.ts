// @effect-diagnostics nodeBuiltinImport:off - Reads Vite outDir, vercel.ts, and release.yml.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { config as webVercelConfig } from "../vercel.ts";

const webRoot = NodePath.resolve(import.meta.dirname, "..");
const repoRoot = NodePath.resolve(webRoot, "../..");

const viteConfigSource = NodeFS.readFileSync(NodePath.join(webRoot, "vite.config.ts"), "utf8");
const viteOutDirMatch = viteConfigSource.match(/outDir:\s*"([^"]+)"/);
const releaseWorkflow = NodeFS.readFileSync(
  NodePath.join(repoRoot, ".github/workflows/release.yml"),
  "utf8",
);

describe("hosted web Vercel output", () => {
  it("matches the Vite emit directory, not Vercel's default public folder", () => {
    expect(viteOutDirMatch?.[1]).toBe("dist");
    expect(webVercelConfig.outputDirectory).toBe("dist");
  });

  it("does not add a repo-root vercel.ts that would host the SPA on kata-code", () => {
    expect(NodeFS.existsSync(NodePath.join(repoRoot, "vercel.ts"))).toBe(false);
  });

  it("pins deploy_web to the hosted project id and refuses kata-code", () => {
    expect(releaseWorkflow).toContain(".vercel/project.json");
    expect(releaseWorkflow).toContain("katacode-web");
    expect(releaseWorkflow).toContain("/kata-code");
  });
});
