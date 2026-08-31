import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { decodeSandboxSourceManifest } from "../src/imageManifest.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const packageDirectory = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const repositoryRoot = NodePath.resolve(packageDirectory, "../..");
const sourceManifestPath = NodePath.join(packageDirectory, "source-manifest.json");

function readSourceManifest() {
  return decodeSandboxSourceManifest(JSON.parse(NodeFS.readFileSync(sourceManifestPath, "utf8")));
}

function sha256(path) {
  return NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(path)).digest("hex");
}

function sha512Integrity(path) {
  return `sha512-${NodeCrypto.createHash("sha512").update(NodeFS.readFileSync(path)).digest("base64")}`;
}

async function packageJsonFromArchive(archive) {
  const { stdout } = await exec("tar", ["-xOf", archive, "package/package.json"]);
  return JSON.parse(stdout);
}

const sourceManifest = readSourceManifest();
const imageTag = process.env.KATACODE_SANDBOX_IMAGE_TAG?.trim() || "kata-sandbox-local:issue-163";
const context = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kata-sandbox-image-"));

try {
  const artifacts = NodePath.join(context, "artifacts");
  const metadataPath = NodePath.join(context, "buildx-metadata.json");
  await NodeFSP.mkdir(artifacts, { recursive: true });
  await NodeFSP.cp(
    NodePath.join(packageDirectory, "bootstrap"),
    NodePath.join(context, "bootstrap"),
    { recursive: true },
  );

  await exec("vp", ["run", "--filter", "@kata-sh/code-cli", "build:bundle"], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  const packed = await exec(
    "npm",
    [
      "pack",
      `${sourceManifest.codex.package}@${sourceManifest.codex.version}`,
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      artifacts,
    ],
    { cwd: repositoryRoot },
  );
  const packageRecords = JSON.parse(packed.stdout);
  const packedFilename = packageRecords[0]?.filename;
  if (typeof packedFilename !== "string")
    throw new Error("npm pack did not return a Codex tarball.");
  const codexArchive = NodePath.join(artifacts, NodePath.basename(packedFilename));
  const codexPackage = await packageJsonFromArchive(codexArchive);
  if (
    codexPackage.name !== sourceManifest.codex.package ||
    codexPackage.version !== sourceManifest.codex.version
  ) {
    throw new Error(`Expected ${sourceManifest.codex.package}@${sourceManifest.codex.version}.`);
  }
  if (sha512Integrity(codexArchive) !== sourceManifest.codex.integrity) {
    throw new Error(
      `The downloaded ${sourceManifest.codex.package} package does not match source-manifest.json.`,
    );
  }
  await NodeFSP.rename(codexArchive, NodePath.join(artifacts, "codex.tgz"));

  const packedKata = await exec("npm", ["pack", "--json", "--pack-destination", artifacts], {
    cwd: NodePath.join(repositoryRoot, "apps/server"),
  });
  const kataRecords = JSON.parse(packedKata.stdout);
  const kataFilename = kataRecords[0]?.filename;
  if (typeof kataFilename !== "string") throw new Error("npm pack did not return a Kata tarball.");
  await NodeFSP.copyFile(
    NodePath.join(artifacts, NodePath.basename(kataFilename)),
    NodePath.join(artifacts, "kata-code-cli.tgz"),
  );

  const kataPackage = JSON.parse(
    await NodeFSP.readFile(NodePath.join(repositoryRoot, "apps/server/package.json"), "utf8"),
  );
  const kataDigest = sha256(NodePath.join(artifacts, "kata-code-cli.tgz"));
  const codexDigest = sha256(NodePath.join(artifacts, "codex.tgz"));
  const platform = (
    await exec("docker", ["version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"])
  ).stdout.trim();
  if (!/^linux\/(amd64|arm64)$/.test(platform)) {
    throw new Error(`Unsupported Docker platform ${platform}.`);
  }

  await exec(
    "docker",
    [
      "buildx",
      "build",
      "--platform",
      platform,
      "--load",
      "--metadata-file",
      metadataPath,
      "--file",
      NodePath.join(packageDirectory, "Dockerfile"),
      "--tag",
      imageTag,
      "--build-arg",
      `KATACODE_BASE_IMAGE=${sourceManifest.baseImage}`,
      "--build-arg",
      `KATACODE_CLI_VERSION=${kataPackage.version}`,
      "--build-arg",
      `KATACODE_CLI_SHA256=${kataDigest}`,
      "--build-arg",
      `KATACODE_CLI_PACKAGE=${kataPackage.name}`,
      "--build-arg",
      `CODEX_VERSION=${codexPackage.version}`,
      "--build-arg",
      `CODEX_SHA256=${codexDigest}`,
      "--build-arg",
      `CODEX_PACKAGE=${codexPackage.name}`,
      context,
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  const imageId = (
    await exec("docker", ["image", "inspect", "--format", "{{.Id}}", imageTag])
  ).stdout.trim();
  if (!/^sha256:[0-9a-f]{64}$/i.test(imageId)) {
    throw new Error("Docker image inspect did not return an immutable image ID.");
  }
  const buildMetadata = NodeFS.existsSync(metadataPath)
    ? JSON.parse(await NodeFSP.readFile(metadataPath, "utf8"))
    : {};
  process.stdout.write(
    [
      `image=${imageId}`,
      `platform=${platform}`,
      `KATACODE_SANDBOX_BASE_IMAGE=${sourceManifest.baseImage}`,
      `KATACODE_SANDBOX_SERVER_ARTIFACT_SHA256=${kataDigest}`,
      `KATACODE_SANDBOX_CODEX_VERSION=${codexPackage.version}`,
      `KATACODE_SANDBOX_CODEX_ARTIFACT_SHA256=${codexDigest}`,
      `KATACODE_SANDBOX_CODEX_INTEGRITY=${sourceManifest.codex.integrity}`,
      `KATACODE_SANDBOX_BUILDX_METADATA=${JSON.stringify(buildMetadata)}`,
    ].join("\n") + "\n",
  );
} finally {
  await NodeFSP.rm(context, { recursive: true, force: true });
}
