import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const packageDirectory = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const repositoryRoot = NodePath.resolve(packageDirectory, "../..");

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function sha256(path) {
  return NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(path)).digest("hex");
}

async function packageJsonFromArchive(archive) {
  const { stdout } = await exec("tar", ["-xOf", archive, "package/package.json"]);
  return JSON.parse(stdout);
}

const baseImage = requiredEnvironment("KATACODE_SANDBOX_BASE_IMAGE");
if (!/^[^\s@]+@sha256:[0-9a-f]{64}$/i.test(baseImage)) {
  throw new Error("KATACODE_SANDBOX_BASE_IMAGE must be a repository@sha256 digest.");
}
const codexArchive = NodePath.resolve(requiredEnvironment("KATACODE_SANDBOX_CODEX_TARBALL"));
const imageTag = process.env.KATACODE_SANDBOX_IMAGE_TAG?.trim() || "kata-sandbox-local:issue-159";
const context = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kata-sandbox-image-"));

try {
  const artifacts = NodePath.join(context, "artifacts");
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
  const packed = await exec("npm", ["pack", "--json", "--pack-destination", artifacts], {
    cwd: NodePath.join(repositoryRoot, "apps/server"),
  });
  const packageRecords = JSON.parse(packed.stdout);
  const packedFilename = packageRecords[0]?.filename;
  if (typeof packedFilename !== "string")
    throw new Error("npm pack did not return a Kata tarball.");
  const packedArchive = NodePath.join(artifacts, NodePath.basename(packedFilename));
  const kataArchive = NodePath.join(artifacts, "kata-code-cli.tgz");
  await NodeFSP.copyFile(packedArchive, kataArchive);
  await NodeFSP.copyFile(codexArchive, NodePath.join(artifacts, "codex.tgz"));

  const kataPackage = JSON.parse(
    await NodeFSP.readFile(NodePath.join(repositoryRoot, "apps/server/package.json"), "utf8"),
  );
  const codexPackage = await packageJsonFromArchive(NodePath.join(artifacts, "codex.tgz"));
  if (codexPackage.name !== "@openai/codex") {
    throw new Error(`Expected @openai/codex, received ${String(codexPackage.name)}.`);
  }

  const kataDigest = sha256(kataArchive);
  const codexDigest = sha256(NodePath.join(artifacts, "codex.tgz"));
  await exec(
    "docker",
    [
      "build",
      "--file",
      NodePath.join(packageDirectory, "Dockerfile"),
      "--tag",
      imageTag,
      "--build-arg",
      `KATACODE_BASE_IMAGE=${baseImage}`,
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
  const image = (
    await exec("docker", ["image", "inspect", "--format", "{{.Id}}", imageTag])
  ).stdout.trim();
  process.stdout.write(
    [
      `image=${imageTag}@${image}`,
      `KATACODE_SANDBOX_SERVER_ARTIFACT_SHA256=${kataDigest}`,
      `KATACODE_SANDBOX_CODEX_VERSION=${codexPackage.version}`,
      `KATACODE_SANDBOX_CODEX_ARTIFACT_SHA256=${codexDigest}`,
    ].join("\n") + "\n",
  );
} finally {
  await NodeFSP.rm(context, { recursive: true, force: true });
}
