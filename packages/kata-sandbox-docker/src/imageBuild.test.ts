// @effect-diagnostics nodeBuiltinImport:off - this test reads the adjacent Dockerfile.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";

import {
  buildImageDockerArgs,
  createImageBuildFacts,
  extractBuildxIndexDigest,
  ghaCacheFlags,
  normalizeDockerPlatforms,
  parseImageBuildArgs,
  prepareSandboxRuntimeLock,
  sandboxImageBuildCacheScope,
  validatePushedImageTags,
} from "./imageBuild.ts";

const sourceManifest = {
  version: 1 as const,
  baseImage: `docker.io/library/node:24-bookworm-slim@sha256:${"a".repeat(64)}`,
  codex: {
    package: "@openai/codex" as const,
    version: "0.151.0",
    integrity: `sha512-${"a".repeat(86)}==`,
  },
};

const kataPackage = { name: "@kata-sh/code-cli", version: "0.0.43" };
const codexPackage = { name: "@openai/codex", version: "0.151.0" };

function artifactFacts() {
  return createImageBuildFacts({
    mode: "registry",
    platforms: ["linux/amd64", "linux/arm64"],
    reference: "vcr.vercel.com/team/project/kata-sandbox",
    tags: ["vcr.vercel.com/team/project/kata-sandbox:0.0.43"],
    indexDigest: `sha256:${"b".repeat(64)}`,
    sourceManifest,
    kataPackage,
    kataArtifactSha256: "c".repeat(64),
    codexPackage,
    codexArtifactSha256: "d".repeat(64),
    buildxMetadata: { "containerimage.digest": `sha256:${"b".repeat(64)}` },
  });
}

describe("image build boundaries", () => {
  it("parses release arguments without environment-supplied provenance", () => {
    assert.deepEqual(
      parseImageBuildArgs([
        "--platform",
        "linux/amd64,linux/arm64",
        "--push",
        "--reference",
        "vcr.vercel.com/team/project/kata-sandbox",
        "--tag",
        "vcr.vercel.com/team/project/kata-sandbox:0.0.43",
        "--output-file",
        "/tmp/image.json",
      ]),
      {
        platforms: "linux/amd64,linux/arm64",
        push: true,
        reference: "vcr.vercel.com/team/project/kata-sandbox",
        tags: ["vcr.vercel.com/team/project/kata-sandbox:0.0.43"],
        imageTag: undefined,
        outputFile: "/tmp/image.json",
      },
    );
  });

  it("builds a local Buildx command with --load", () => {
    const args = buildImageDockerArgs({
      platforms: "linux/arm64",
      push: false,
      tags: ["kata-sandbox-local"],
      metadataPath: "/tmp/buildx.json",
      dockerfilePath: "/repo/Dockerfile",
      contextPath: "/tmp/context",
      buildArgs: ["KATACODE_BASE_IMAGE=node@sha256:" + "a".repeat(64)],
    });
    assert.deepEqual(args.slice(0, 9), [
      "buildx",
      "build",
      "--platform",
      "linux/arm64",
      "--load",
      "--metadata-file",
      "/tmp/buildx.json",
      "--file",
      "/repo/Dockerfile",
    ]);
    assert.include(args, "--tag");
    assert.include(args, "/tmp/context");
    assert.notInclude(args, "--push");
  });

  it("adds buildx cache flags keyed on the source manifest and lockfile", () => {
    const scope = sandboxImageBuildCacheScope("source", "lock");
    const cache = ghaCacheFlags(scope);
    const args = buildImageDockerArgs({
      platforms: "linux/arm64",
      push: false,
      tags: ["kata-sandbox-local"],
      metadataPath: "/tmp/buildx.json",
      dockerfilePath: "/repo/Dockerfile",
      contextPath: "/tmp/context",
      buildArgs: [],
      ...cache,
    });
    assert.match(scope, /^kata-sandbox-[0-9a-f]{12}$/);
    assert.include(args, "--cache-from");
    assert.include(args, `type=gha,scope=${scope}`);
    assert.include(args, "--cache-to");
    assert.include(args, `type=gha,mode=max,scope=${scope}`);
  });

  it("stamps Kata sandbox labels from the image build args", () => {
    const dockerfile = NodeFS.readFileSync(
      NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../Dockerfile"),
      "utf8",
    );
    assert.include(dockerfile, "com.katacode.sandbox.kata-version");
    assert.include(dockerfile, "com.katacode.sandbox.server-version");
    assert.include(dockerfile, "com.katacode.sandbox.server-artifact-sha256");
    assert.include(dockerfile, "com.katacode.sandbox.codex-version");
    assert.include(dockerfile, "com.katacode.sandbox.codex-artifact-sha256");
  });

  it("builds a zstd OCI registry export for both platforms", () => {
    const args = buildImageDockerArgs({
      platforms: "linux/amd64,linux/arm64",
      push: true,
      tags: ["vcr.vercel.com/team/project/kata-sandbox:0.0.43"],
      metadataPath: "/tmp/buildx.json",
      dockerfilePath: "/repo/Dockerfile",
      contextPath: "/tmp/context",
      buildArgs: [],
    });
    assert.equal(args[4], "--output");
    assert.include(String(args[5]), "push=true");
    assert.include(String(args[5]), "oci-mediatypes=true");
    assert.include(String(args[5]), "compression=zstd");
    assert.equal(args[2], "--platform");
    assert.equal(args[3], "linux/amd64,linux/arm64");
  });

  it("allows a pushed image to use an explicit mirror repository", () => {
    assert.doesNotThrow(() =>
      validatePushedImageTags("vcr.vercel.com/team/project/kata-sandbox", [
        "vcr.vercel.com/team/project/kata-sandbox:0.0.43",
        "ghcr.io/gannonh/kata-sandbox:0.0.43",
      ]),
    );
  });

  it("reads the immutable digest emitted by Buildx metadata", () => {
    const digest = `sha256:${"e".repeat(64)}`;
    assert.equal(extractBuildxIndexDigest({ "containerimage.digest": digest }), digest);
    assert.equal(extractBuildxIndexDigest({ "containerimage.descriptor": { digest } }), digest);
    assert.isUndefined(extractBuildxIndexDigest({ "containerimage.digest": "tag" }));
  });

  it("keeps the release facts provenance-only and rejects mismatched artifacts", () => {
    const facts = artifactFacts();
    assert.equal(facts.baseDigest, `sha256:${"a".repeat(64)}`);
    assert.equal(facts.kataArtifactSha256, "c".repeat(64));
    assert.equal(facts.serverArtifactSha256, "c".repeat(64));
    assert.equal(facts.codexIntegrity, sourceManifest.codex.integrity);
    assert.notInclude(JSON.stringify(facts), "VERCEL_TOKEN");
    assert.throws(
      () =>
        createImageBuildFacts({
          mode: "registry",
          platforms: ["linux/amd64", "linux/arm64"],
          reference: "vcr.vercel.com/team/project/kata-sandbox",
          tags: ["vcr.vercel.com/team/project/kata-sandbox:0.0.43"],
          indexDigest: `sha256:${"b".repeat(64)}`,
          sourceManifest,
          kataPackage,
          kataArtifactSha256: "c".repeat(64),
          codexPackage: { name: "@openai/codex", version: "0.150.0" },
          codexArtifactSha256: "d".repeat(64),
          buildxMetadata: { "containerimage.digest": `sha256:${"b".repeat(64)}` },
        }),
      /packed Codex artifact does not match/,
    );
  });

  it("deduplicates and validates supported target platforms", () => {
    assert.deepEqual(normalizeDockerPlatforms("linux/arm64,linux/arm64"), ["linux/arm64"]);
    assert.throws(() => normalizeDockerPlatforms("linux/386"), /Unsupported Docker platform/);
  });

  it("keeps the runtime lock CLI graph aligned with the packed server package", () => {
    const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
    const server = JSON.parse(
      NodeFS.readFileSync(NodePath.join(here, "../../../apps/server/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const lock = JSON.parse(
      NodeFS.readFileSync(NodePath.join(here, "../runtime-package-lock.json"), "utf8"),
    ) as {
      packages?: Record<string, { dependencies?: Record<string, string> }>;
    };
    const cliDeps = lock.packages?.["node_modules/@kata-sh/code-cli"]?.dependencies ?? {};
    assert.deepEqual(
      Object.keys(server.dependencies ?? {})
        .filter((name) => !(name in cliDeps))
        .sort(),
      [],
    );
  });

  it("omits unused Claude platform packages from the lock npm ci installs", () => {
    const lock = JSON.parse(
      NodeFS.readFileSync(
        NodePath.join(
          NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
          "../runtime-package-lock.json",
        ),
        "utf8",
      ),
    ) as { packages?: Record<string, { optionalDependencies?: Record<string, string> }> };
    const prepared = prepareSandboxRuntimeLock(lock);
    const packages = prepared.packages;
    assert.isTrue(packages !== null && typeof packages === "object");
    const packagePaths = Object.keys(packages as object);
    assert.equal(
      packagePaths.filter((path) =>
        /node_modules\/@anthropic-ai\/claude-agent-sdk-(darwin|linux|win32)-/.test(path),
      ).length,
      0,
    );
    const claudeSdk = Reflect.get(
      packages as object,
      "node_modules/@anthropic-ai/claude-agent-sdk",
    ) as { optionalDependencies?: Record<string, string> } | undefined;
    assert.deepEqual(claudeSdk?.optionalDependencies ?? {}, {});
  });

  it("first publishes Codex linux natives via COPY --from a prior stage", () => {
    const dockerfile = NodeFS.readFileSync(
      NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../Dockerfile"),
      "utf8",
    );
    const plan = publishedSandboxLayerPlan(dockerfile);
    assert.notEqual(plan.npmCiStage, plan.finalStage);
    assert.isFalse(plan.finalInstructions.some((line) => line.includes("npm ci")));
    assert.isDefined(plan.artifactCopyFromNpm);
    assert.isDefined(plan.codexNativeCopyFromNpm);
    assert.isBelow(plan.artifactCopyIndex, plan.codexNativeCopyIndex);
  });

  it("rejects parking Codex natives in the published npm ci layer", () => {
    assert.throws(
      () =>
        publishedSandboxLayerPlan(`
ARG KATACODE_BASE_IMAGE
FROM \${KATACODE_BASE_IMAGE}
RUN npm ci && mv node_modules/@openai/codex-linux-* /opt/kata-sandbox-codex-native/
RUN mv /opt/kata-sandbox-codex-native/codex-linux-* node_modules/@openai/
`),
      /published stage must not run npm ci/,
    );
  });
});

function dockerfileLogicalLines(source: string): string[] {
  return source
    .replace(/\\\n/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function publishedSandboxLayerPlan(source: string): {
  readonly npmCiStage: string;
  readonly finalStage: string;
  readonly finalInstructions: ReadonlyArray<string>;
  readonly artifactCopyFromNpm: string | undefined;
  readonly codexNativeCopyFromNpm: string | undefined;
  readonly artifactCopyIndex: number;
  readonly codexNativeCopyIndex: number;
} {
  const stages: Array<{ name: string; instructions: string[] }> = [];
  let unnamed = 0;
  for (const line of dockerfileLogicalLines(source)) {
    const from = /^FROM\s+\S+(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      stages.push({ name: from[1] ?? `unnamed-${String(unnamed++)}`, instructions: [] });
      continue;
    }
    stages.at(-1)?.instructions.push(line);
  }
  const npmCiStage = stages.find((stage) =>
    stage.instructions.some((line) => line.includes("npm ci")),
  );
  const final = stages.at(-1);
  if (npmCiStage === undefined || final === undefined) {
    throw new Error("Dockerfile must run npm ci and have a final stage.");
  }
  if (npmCiStage.name === final.name) {
    throw new Error("published stage must not run npm ci");
  }
  const copies = final.instructions.filter((line) => line.startsWith("COPY --from="));
  const artifactCopyFromNpm = copies.find(
    (line) =>
      line.includes(`--from=${npmCiStage.name}`) &&
      line.includes("kata-sandbox-artifacts") &&
      !line.includes("kata-sandbox-codex-native"),
  );
  const codexNativeCopyFromNpm = copies.find(
    (line) =>
      line.includes(`--from=${npmCiStage.name}`) && line.includes("kata-sandbox-codex-native"),
  );
  return {
    npmCiStage: npmCiStage.name,
    finalStage: final.name,
    finalInstructions: final.instructions,
    artifactCopyFromNpm,
    codexNativeCopyFromNpm,
    artifactCopyIndex: artifactCopyFromNpm === undefined ? -1 : copies.indexOf(artifactCopyFromNpm),
    codexNativeCopyIndex:
      codexNativeCopyFromNpm === undefined ? -1 : copies.indexOf(codexNativeCopyFromNpm),
  };
}
