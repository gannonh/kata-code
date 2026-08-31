// @effect-diagnostics nodeBuiltinImport:off - tests exercise the file and command boundary.
import { assert, describe, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import {
  assertPublishedImageVerifyCommands,
  makeSandboxImageArtifact,
  parsePlatformDigests,
  parseReleaseImageArgs,
  verifyAndWriteSandboxImage,
  vcrReadinessUrl,
  waitForVcrAmd64Ready,
} from "./release-sandbox-image.ts";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

const repository = "vcr.vercel.com/team/project/kata-sandbox";
const indexDigest = `sha256:${"a".repeat(64)}`;
const amd64Digest = `sha256:${"b".repeat(64)}`;
const arm64Digest = `sha256:${"c".repeat(64)}`;
const buildOutput = {
  version: 1,
  mode: "registry",
  reference: repository,
  platforms: ["linux/amd64", "linux/arm64"],
  tags: [`${repository}:0.0.43`],
  indexDigest,
  baseImage: `docker.io/library/node:24-bookworm-slim@${indexDigest}`,
  baseDigest: indexDigest,
  kataPackage: "@kata-sh/code-cli",
  kataVersion: "0.0.43",
  kataArtifactSha256: "d".repeat(64),
  serverArtifactSha256: "d".repeat(64),
  codexPackage: "@openai/codex",
  codexVersion: "0.151.0",
  codexArtifactSha256: "e".repeat(64),
  codexIntegrity: `sha512-${"f".repeat(86)}==`,
};

const index = {
  manifests: [
    { digest: amd64Digest, platform: { os: "linux", architecture: "amd64" } },
    { digest: arm64Digest, platform: { os: "linux", architecture: "arm64" } },
    { digest: `sha256:${"1".repeat(64)},`, platform: { os: "unknown", architecture: "unknown" } },
  ],
};

describe("release sandbox image boundaries", () => {
  it("passes the VCR project to the Vercel Sandbox smoke test", () => {
    const workflow = NodeFS.readFileSync(
      NodePath.join(import.meta.dirname, "../.github/workflows/release.yml"),
      "utf8",
    );
    const smokeStart = workflow.indexOf("KATACODE_VERCEL_IMAGE_E2E=1");
    const smokeEnd = workflow.indexOf(
      "vp test run scripts/verify-kata-sandbox-image-vercel.test.ts",
    );
    assert.isAtLeast(smokeStart, 0);
    assert.isAbove(smokeEnd, smokeStart);

    const smokeCommand = workflow.slice(smokeStart, smokeEnd);
    assert.include(smokeCommand, 'VERCEL_ORG_ID="$VCR_ORG_ID"');
    assert.include(smokeCommand, 'VERCEL_PROJECT_ID="$VCR_PROJECT_ID"');
  });

  it("derives exact and discovery tags without parsing release logs", () => {
    assert.deepEqual(
      parseReleaseImageArgs(
        [
          "--version",
          "0.0.43",
          "--channel",
          "nightly",
          "--repository",
          repository,
          "--build-output",
          "/tmp/build.json",
          "--output",
          "/tmp/sandbox-image.json",
          "--project-id",
          "project-id",
          "--team-slug",
          "team",
          "--token",
          "secret-token",
        ],
        {},
      ),
      {
        version: "0.0.43",
        channel: "nightly",
        repository,
        buildOutput: "/tmp/build.json",
        output: "/tmp/sandbox-image.json",
        projectId: "project-id",
        teamSlug: "team",
        token: "secret-token",
        makeLatest: false,
        timeoutMs: 20 * 60_000,
        pollMs: 10_000,
      },
    );
    assert.equal(
      vcrReadinessUrl({ repository, projectId: "project-id", teamSlug: "team" }),
      "https://api.vercel.com/v1/vcr/repository/kata-sandbox/images?projectId=project-id&slug=team",
    );
  });

  it("rejects pulling one index digest for two platforms", () => {
    assert.throws(
      () =>
        assertPublishedImageVerifyCommands(
          [
            ["docker", "pull", "--platform", "linux/amd64", `${repository}@${indexDigest}`],
            ["docker", "pull", "--platform", "linux/arm64", `${repository}@${indexDigest}`],
          ],
          indexDigest,
        ),
      /cannot overwrite digest/,
    );
  });

  it("inspects the mirrored public index once", () => {
    const workflow = NodeFS.readFileSync(
      NodePath.join(repoRoot, ".github/workflows/release.yml"),
      "utf8",
    );
    assert.include(workflow, "buildx imagetools inspect");
    assert.notInclude(workflow, 'docker pull --platform');
    assert.doesNotThrow(() =>
      assertPublishedImageVerifyCommands(
        [
          [
            "docker",
            "--config",
            "/tmp/docker-anonymous",
            "buildx",
            "imagetools",
            "inspect",
            `ghcr.io/gannonh/kata-sandbox@${indexDigest}`,
          ],
        ],
        indexDigest,
      ),
    );
  });

  it("requires both supported platform manifests", () => {
    assert.deepEqual(parsePlatformDigests(index), {
      "linux/amd64": amd64Digest,
      "linux/arm64": arm64Digest,
    });
    assert.throws(
      () =>
        parsePlatformDigests({
          manifests: [{ digest: amd64Digest, platform: { os: "linux", architecture: "amd64" } }],
        }),
      /missing linux\/arm64/,
    );
  });

  it("polls injected VCR responses until the amd64 image is ready", async () => {
    let calls = 0;
    let clock = 0;
    const result = await waitForVcrAmd64Ready({
      url: "https://api.vercel.com/v1/vcr/repository/kata-sandbox/images",
      token: "secret-token",
      platformDigest: amd64Digest,
      timeoutMs: 100,
      pollMs: 10,
      now: () => clock,
      sleep: async () => {
        clock += 10;
      },
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          images: [
            {
              manifestDigest: amd64Digest,
              platform: "linux",
              arch: "amd64",
              status: calls++ === 0 ? "preparing" : "ready",
            },
          ],
        }),
      }),
    });
    assert.equal(result.status, "ready");
    assert.equal(calls, 2);
  });

  it("writes a credential-free artifact after immutable smoke checks", async () => {
    const directory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "kata-release-image-test-"),
    );
    try {
      const buildPath = NodePath.join(directory, "build.json");
      const outputPath = NodePath.join(directory, "sandbox-image.json");
      NodeFS.writeFileSync(buildPath, JSON.stringify(buildOutput));
      const commands: Array<ReadonlyArray<string>> = [];
      const artifact = await verifyAndWriteSandboxImage({
        options: {
          version: "0.0.43",
          channel: "stable",
          repository,
          buildOutput: buildPath,
          output: outputPath,
          projectId: "project-id",
          teamSlug: "team",
          token: "secret-token",
          makeLatest: true,
          timeoutMs: 100,
          pollMs: 10,
        },
        runCommand: async (command, args) => {
          commands.push([command, ...args]);
          if (command === "docker" && args.includes("--raw")) {
            const reference = args.at(-1) ?? "";
            return {
              stdout:
                reference.endsWith(amd64Digest) || reference.endsWith(arm64Digest)
                  ? JSON.stringify({ config: { digest: `sha256:${"1".repeat(64)}` }, layers: [] })
                  : JSON.stringify(index),
              stderr: "",
            };
          }
          return { stdout: "", stderr: "" };
        },
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            images: [
              { manifestDigest: amd64Digest, platform: "linux", arch: "amd64", status: "ready" },
            ],
          }),
        }),
      });
      const serialized = NodeFS.readFileSync(outputPath, "utf8");
      assert.equal(artifact.immutableReference, `${repository}@${indexDigest}`);
      assert.equal(artifact.platformDigests["linux/amd64"], amd64Digest);
      assert.include(serialized, "codexIntegrity");
      assert.notInclude(serialized, "secret-token");
      assert.isTrue(commands.some((args) => args.includes("--raw")));
      assert.equal(commands.filter((args) => args[0] === "docker" && args[1] === "run").length, 2);
      assert.isTrue(
        commands
          .filter((args) => args[0] === "docker" && args[1] === "run")
          .every((args) => args.includes(`${repository}@${amd64Digest}`) || args.includes(`${repository}@${arm64Digest}`)),
      );
      assert.doesNotThrow(() => assertPublishedImageVerifyCommands(commands, indexDigest));
      assert.isTrue(commands.some((args) => args.includes(`${repository}:latest`)));
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not manufacture an artifact from mutable provenance", () => {
    assert.throws(
      () =>
        makeSandboxImageArtifact({
          repository,
          indexDigest: "latest",
          platformDigests: { "linux/amd64": amd64Digest, "linux/arm64": arm64Digest },
          baseDigest: indexDigest,
          kataVersion: "0.0.43",
          kataArtifactSha256: "d".repeat(64),
          codexVersion: "0.151.0",
          codexArtifactSha256: "e".repeat(64),
          codexIntegrity: buildOutput.codexIntegrity,
        }),
      /immutable sha256 digests/,
    );
  });
});
