import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";

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

describe("release sandbox image Vercel auth contract", () => {
  it("injects hosted Sandbox.create credentials without retargeting VCR push", () => {
    const job = sandboxImageJob(readReleaseWorkflow());
    assert.include(job, "VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}");
    assert.include(job, "VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}");
    assert.include(job, "VCR_ORG_ID: ${{ secrets.VCR_ORG_ID }}");
    assert.include(job, "VCR_PROJECT_ID: ${{ secrets.VCR_PROJECT_ID }}");
    assert.include(job, "required=(VERCEL_TOKEN VCR_ORG_ID VCR_PROJECT_ID VERCEL_ORG_ID VERCEL_PROJECT_ID)");
    assert.include(job, '--project "$VCR_PROJECT_ID"');
    assert.notInclude(job, '--project "$VERCEL_PROJECT_ID"');
    assert.notInclude(job, "VERCEL_ORG_ID: ${{ secrets.VCR_ORG_ID }}");
    assert.notInclude(job, "VERCEL_PROJECT_ID: ${{ secrets.VCR_PROJECT_ID }}");
  });
});
