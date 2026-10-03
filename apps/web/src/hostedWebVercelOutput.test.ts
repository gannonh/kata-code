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

const jobBlock = (name: string): string => {
  const start = releaseWorkflow.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`release.yml has no ${name} job`);
  const next = /\n {2}[a-z_]+:\n/.exec(releaseWorkflow.slice(start + 1));
  return releaseWorkflow.slice(start, next === null ? undefined : start + 1 + next.index);
};

describe("hosted web Vercel output", () => {
  it("matches the Vite emit directory, not Vercel's default public folder", () => {
    expect(viteOutDirMatch?.[1]).toBe("dist");
    expect(webVercelConfig.outputDirectory).toBe("dist");
  });

  it("does not add a repo-root vercel.ts that would host the SPA on kata-code", () => {
    expect(NodeFS.existsSync(NodePath.join(repoRoot, "vercel.ts"))).toBe(false);
  });

  it("keeps the project pin and exact-name guard inside build_web, the job that creates the deployment", () => {
    const buildWeb = jobBlock("build_web");
    expect(buildWeb).toContain('printf \'{"orgId":"%s","projectId":"%s"}\\n\'');
    expect(buildWeb).toContain("> .vercel/project.json");
    expect(buildWeb).toContain('hosted_project_slug="katacode-web"');
    expect(buildWeb).toContain(
      'node scripts/assert-hosted-web-project.ts --log "$deploy_log" --project "$hosted_project_slug"',
    );
    expect(buildWeb.indexOf("> .vercel/project.json")).toBeLessThan(
      buildWeb.indexOf("vercel@53.1.1 deploy"),
    );
    expect(buildWeb.indexOf("vercel@53.1.1 deploy")).toBeLessThan(
      buildWeb.indexOf("assert-hosted-web-project.ts"),
    );
  });

  it("makes deploy_web only alias what build_web staged", () => {
    const deployWeb = jobBlock("deploy_web");
    expect(deployWeb).toContain("needs: [preflight, build_web, release]");
    expect(deployWeb).toContain("needs.build_web.outputs.deployment_url");
    expect(deployWeb).toContain("alias set");
    expect(deployWeb).not.toContain("vercel@53.1.1 deploy");
    expect(deployWeb).not.toContain(".vercel/project.json");
  });
});
