// @effect-diagnostics nodeBuiltinImport:off - tests exercise the file and command boundary.
import { assert, describe, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  makeSandboxImageArtifact,
  managedSandboxImageRepository,
  parsePlatformDigests,
  parsePrintRepositoryArgs,
  parseReleaseImageArgs,
  projectSlugFromVercelProject,
  resolveReleaseSandboxImageRepository,
  resolveSandboxImageRepository,
  vercelProjectInspectUrl,
  verifyAndWriteSandboxImage,
  vcrReadinessUrl,
  waitForVcrAmd64Ready,
} from "./release-sandbox-image.ts";

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
  it("builds the VCR path from the authenticated team and project", () => {
    assert.equal(
      managedSandboxImageRepository({ teamSlug: "acme", projectSlug: "katacode-web" }),
      "vcr.vercel.com/acme/katacode-web/kata-sandbox",
    );
    assert.equal(
      vercelProjectInspectUrl({
        projectId: "prj_123",
        teamId: "team_123",
        teamSlug: "acme",
      }),
      "https://api.vercel.com/v9/projects/prj_123?teamId=team_123&slug=acme",
    );
    assert.equal(projectSlugFromVercelProject({ name: "katacode-web" }), "katacode-web");
  });

  it("does not push to a VCR project that the docker OIDC token cannot read", () => {
    assert.deepEqual(
      resolveSandboxImageRepository({
        teamSlug: "acme",
        projectSlug: "katacode-web",
        override: "vcr.vercel.com/acme/kata-code/kata-sandbox",
      }),
      {
        repository: "vcr.vercel.com/acme/katacode-web/kata-sandbox",
        ignoredOverride: "vcr.vercel.com/acme/kata-code/kata-sandbox",
      },
    );
    assert.deepEqual(
      resolveSandboxImageRepository({
        teamSlug: "acme",
        projectSlug: "katacode-web",
        override: "vcr.vercel.com/acme/katacode-web/kata-sandbox",
      }),
      { repository: "vcr.vercel.com/acme/katacode-web/kata-sandbox" },
    );
  });

  it("reads the project name from the Vercel project used for vcr login", async () => {
    const requested: string[] = [];
    const result = await resolveReleaseSandboxImageRepository({
      projectId: "prj_123",
      teamId: "team_123",
      teamSlug: "acme",
      token: "secret-token",
      override: "vcr.vercel.com/acme/kata-code/kata-sandbox",
      fetch: async (url) => {
        requested.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ name: "katacode-web" }),
        };
      },
    });
    assert.deepEqual(requested, [
      "https://api.vercel.com/v9/projects/prj_123?teamId=team_123&slug=acme",
    ]);
    assert.deepEqual(result, {
      repository: "vcr.vercel.com/acme/katacode-web/kata-sandbox",
      projectSlug: "katacode-web",
      ignoredOverride: "vcr.vercel.com/acme/kata-code/kata-sandbox",
    });
    assert.deepEqual(
      parsePrintRepositoryArgs(
        [
          "--print-repository",
          "--project-id",
          "prj_123",
          "--team-id",
          "team_123",
          "--team-slug",
          "acme",
          "--token",
          "secret-token",
          "--override",
          "vcr.vercel.com/acme/kata-code/kata-sandbox",
        ],
        {},
      ),
      {
        projectId: "prj_123",
        teamId: "team_123",
        teamSlug: "acme",
        token: "secret-token",
        override: "vcr.vercel.com/acme/kata-code/kata-sandbox",
      },
    );
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
