// @effect-diagnostics nodeBuiltinImport:off - tests read the release workflow contract from disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";

import {
  resolveVercelSandboxSmokeAuth,
  VERCEL_SANDBOX_SMOKE_AUTH_ERROR,
} from "./vercel-sandbox-smoke-auth.ts";

const repositoryRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);

function readReleaseWorkflow(): string {
  return NodeFS.readFileSync(
    NodePath.join(repositoryRoot, ".github/workflows/release.yml"),
    "utf8",
  );
}

function sandboxImageJob(workflow: string): string {
  const start = workflow.indexOf("  build_sandbox_image:");
  const end = workflow.indexOf("  publish_cli:");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Could not isolate the build_sandbox_image job.");
  }
  return workflow.slice(start, end);
}

const release656JobEnv = {
  VERCEL_TOKEN: "vercel-token",
  VCR_ORG_ID: "vcr-team",
  VCR_PROJECT_ID: "vcr-project",
  VERCEL_TEAM_SLUG: "kata-sh",
  VERCEL_PROJECT_SLUG: "kata-code",
};

describe("resolveVercelSandboxSmokeAuth", () => {
  it("rejects the Release 656 job env that only has VCR registry credentials", () => {
    assert.throws(
      () => resolveVercelSandboxSmokeAuth(release656JobEnv),
      VERCEL_SANDBOX_SMOKE_AUTH_ERROR,
    );
  });

  it("returns hosted Sandbox.create credentials when both project identities are present", () => {
    assert.deepEqual(
      resolveVercelSandboxSmokeAuth({
        ...release656JobEnv,
        VERCEL_ORG_ID: "hosted-team",
        VERCEL_PROJECT_ID: "hosted-project",
      }),
      {
        token: "vercel-token",
        teamId: "hosted-team",
        projectId: "hosted-project",
      },
    );
  });

  it("accepts VERCEL_TEAM_ID as the hosted team alias", () => {
    assert.deepEqual(
      resolveVercelSandboxSmokeAuth({
        VERCEL_TOKEN: "vercel-token",
        VERCEL_TEAM_ID: "hosted-team",
        VERCEL_PROJECT_ID: "hosted-project",
        VCR_ORG_ID: "vcr-team",
        VCR_PROJECT_ID: "vcr-project",
      }),
      {
        token: "vercel-token",
        teamId: "hosted-team",
        projectId: "hosted-project",
      },
    );
  });

  it("trims hosted credential values before returning them", () => {
    assert.deepEqual(
      resolveVercelSandboxSmokeAuth({
        VERCEL_TOKEN: "  vercel-token  ",
        VERCEL_ORG_ID: "  hosted-team  ",
        VERCEL_PROJECT_ID: "  hosted-project  ",
      }),
      {
        token: "vercel-token",
        teamId: "hosted-team",
        projectId: "hosted-project",
      },
    );
  });

  it("rejects whitespace-only required credentials", () => {
    assert.throws(
      () =>
        resolveVercelSandboxSmokeAuth({
          VERCEL_TOKEN: "vercel-token",
          VERCEL_ORG_ID: "   ",
          VERCEL_PROJECT_ID: "hosted-project",
        }),
      VERCEL_SANDBOX_SMOKE_AUTH_ERROR,
    );
  });
});

describe("release sandbox image Vercel auth contract", () => {
  it("injects hosted Sandbox.create credentials without retargeting VCR push", () => {
    const job = sandboxImageJob(readReleaseWorkflow());
    assert.include(job, "VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}");
    assert.include(job, "VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}");
    assert.include(job, "VCR_ORG_ID: ${{ secrets.VCR_ORG_ID }}");
    assert.include(job, "VCR_PROJECT_ID: ${{ secrets.VCR_PROJECT_ID }}");
    assert.include(
      job,
      "required=(VERCEL_TOKEN VCR_ORG_ID VCR_PROJECT_ID VERCEL_ORG_ID VERCEL_PROJECT_ID)",
    );
    assert.include(job, 'if [[ -z "${value//[[:space:]]/}" ]]; then');
    assert.include(job, '--project "$VCR_PROJECT_ID"');
    assert.notInclude(job, '--project "$VERCEL_PROJECT_ID"');
    assert.notInclude(job, "VERCEL_ORG_ID: ${{ secrets.VCR_ORG_ID }}");
    assert.notInclude(job, "VERCEL_PROJECT_ID: ${{ secrets.VCR_PROJECT_ID }}");
    assert.notInclude(job, 'VERCEL_ORG_ID="$VCR_ORG_ID"');
    assert.notInclude(job, 'VERCEL_PROJECT_ID="$VCR_PROJECT_ID"');
  });
});
