// @effect-diagnostics nodeBuiltinImport:off - this is the Docker/npm build boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { decodeSandboxSourceManifest, type SandboxSourceManifest } from "./imageManifest.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const packageDirectory = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const repositoryRoot = NodePath.resolve(packageDirectory, "../..");
const sourceManifestPath = NodePath.join(packageDirectory, "source-manifest.json");
const sha256Pattern = /^sha256:[0-9a-f]{64}$/i;
const dockerPlatformPattern = /^linux\/(amd64|arm64)$/;

export interface ImageBuildCliOptions {
  readonly platforms: string | undefined;
  readonly push: boolean;
  readonly reference: string | undefined;
  readonly tags: ReadonlyArray<string>;
  readonly imageTag: string | undefined;
  readonly outputFile: string | undefined;
}

export interface ImageBuildFacts {
  readonly version: 1;
  readonly mode: "local" | "registry";
  readonly imageId?: string | undefined;
  readonly platform?: string | undefined;
  readonly platforms: ReadonlyArray<string>;
  readonly reference?: string | undefined;
  readonly tags: ReadonlyArray<string>;
  readonly indexDigest?: string | undefined;
  readonly baseImage: string;
  readonly baseDigest: string;
  readonly kataPackage: string;
  readonly kataVersion: string;
  readonly kataArtifactSha256: string;
  readonly serverArtifactSha256: string;
  readonly codexPackage: string;
  readonly codexVersion: string;
  readonly codexArtifactSha256: string;
  readonly codexIntegrity: string;
  readonly buildxMetadata: unknown;
}

export interface ImageBuildCommandInput {
  readonly platforms: string;
  readonly push: boolean;
  readonly tags: ReadonlyArray<string>;
  readonly metadataPath: string;
  readonly dockerfilePath: string;
  readonly contextPath: string;
  readonly buildArgs: ReadonlyArray<string>;
}

function requiredValue(args: ReadonlyArray<string>, index: number, flag: string): string {
  const value = args[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseImageBuildArgs(args: ReadonlyArray<string>): ImageBuildCliOptions {
  let platforms: string | undefined;
  let push = false;
  let reference: string | undefined;
  let imageTag: string | undefined;
  let outputFile: string | undefined;
  const tags: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    switch (flag) {
      case "--platform":
        platforms = requiredValue(args, index, flag);
        index += 1;
        break;
      case "--push":
        push = true;
        break;
      case "--reference":
        reference = requiredValue(args, index, flag);
        index += 1;
        break;
      case "--tag":
        tags.push(requiredValue(args, index, flag));
        index += 1;
        break;
      case "--image-tag":
        imageTag = requiredValue(args, index, flag);
        index += 1;
        break;
      case "--output-file":
        outputFile = requiredValue(args, index, flag);
        index += 1;
        break;
      case undefined:
        break;
      default:
        throw new Error(`Unknown image build argument '${flag}'.`);
    }
  }

  return { platforms, push, reference, tags, imageTag, outputFile };
}

export function normalizeDockerPlatforms(value: string): ReadonlyArray<string> {
  const platforms = value
    .split(",")
    .map((platform) => platform.trim())
    .filter(Boolean);
  if (
    platforms.length === 0 ||
    platforms.some((platform) => !dockerPlatformPattern.test(platform))
  ) {
    throw new Error(`Unsupported Docker platform list '${value}'.`);
  }
  return [...new Set(platforms)];
}

function validateTag(value: string): string {
  const tag = value.trim();
  if (!tag || /[\s,]/.test(tag)) throw new Error(`Invalid Docker image tag '${value}'.`);
  return tag;
}

export function validatePushedImageTags(reference: string, tags: ReadonlyArray<string>): void {
  if (!tags[0]?.startsWith(`${reference}:`)) {
    throw new Error("The first pushed image tag must use the --reference repository.");
  }
}

export function buildImageDockerArgs(input: ImageBuildCommandInput): ReadonlyArray<string> {
  const platforms = normalizeDockerPlatforms(input.platforms);
  const tags = input.tags.map(validateTag);
  if (tags.length === 0) throw new Error("At least one Docker image tag is required.");
  if (!input.push && platforms.length !== 1) {
    throw new Error("Docker --load supports exactly one target platform.");
  }

  const output = input.push
    ? [
        "--output",
        `type=image,name=${tags[0]},push=true,oci-mediatypes=true,compression=zstd,compression-level=3,force-compression=true`,
      ]
    : ["--load"];

  return [
    "buildx",
    "build",
    "--platform",
    platforms.join(","),
    ...output,
    "--metadata-file",
    input.metadataPath,
    "--file",
    input.dockerfilePath,
    ...tags.flatMap((tag) => ["--tag", tag]),
    ...input.buildArgs.flatMap((buildArg) => ["--build-arg", buildArg]),
    input.contextPath,
  ];
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && sha256Pattern.test(value);
}

export function extractBuildxIndexDigest(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const metadata = value as Record<string, unknown>;
  const descriptor = metadata["containerimage.descriptor"];
  const candidates = [
    metadata["containerimage.digest"],
    descriptor && typeof descriptor === "object"
      ? (descriptor as Record<string, unknown>).digest
      : undefined,
  ];
  return candidates.find(isSha256Digest);
}

export function imageDigestFromReference(reference: string): string {
  const at = reference.lastIndexOf("@");
  const digest = reference.slice(at + 1);
  if (at <= 0 || at !== reference.indexOf("@") || !isSha256Digest(digest)) {
    throw new Error(`Expected an immutable sha256 image reference, received '${reference}'.`);
  }
  return digest;
}

function sha256(path: string): string {
  return NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(path)).digest("hex");
}

function sha512Integrity(path: string): string {
  return `sha512-${NodeCrypto.createHash("sha512").update(NodeFS.readFileSync(path)).digest("base64")}`;
}

async function packageJsonFromArchive(archive: string): Promise<Record<string, unknown>> {
  const result = await execFile("tar", ["-xOf", archive, "package/package.json"], {
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(String(result.stdout));
}

const repositoryRequire = NodeModule.createRequire(NodePath.join(repositoryRoot, "package.json"));

function installedPackageVersion(name: string): string {
  const directPackageJson = NodePath.join(
    repositoryRoot,
    "apps/server/node_modules",
    name,
    "package.json",
  );
  if (NodeFS.existsSync(directPackageJson)) {
    const packageJson = JSON.parse(NodeFS.readFileSync(directPackageJson, "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof packageJson.version === "string") return packageJson.version;
  }
  let entry: string;
  try {
    entry = repositoryRequire.resolve(name, {
      paths: [NodePath.join(repositoryRoot, "apps/server")],
    });
  } catch (cause) {
    throw new Error(
      `Cannot resolve installed dependency ${name} for the standalone Kata package: ${String(cause)}`,
      { cause },
    );
  }
  let directory = NodePath.dirname(entry);
  for (;;) {
    const packageJsonPath = NodePath.join(directory, "package.json");
    if (NodeFS.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(NodeFS.readFileSync(packageJsonPath, "utf8")) as Record<
        string,
        unknown
      >;
      if (packageJson.name === name && typeof packageJson.version === "string")
        return packageJson.version;
    }
    const parent = NodePath.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Cannot find installed version for dependency ${name}.`);
}

async function makeInstallableKataArchive(
  sourceArchive: string,
  artifacts: string,
  context: string,
): Promise<string> {
  const unpacked = await NodeFSP.mkdtemp(NodePath.join(context, "kata-package-"));
  await run("tar", ["-xzf", sourceArchive, "-C", unpacked]);
  const packageDirectory = NodePath.join(unpacked, "package");
  const packageJsonPath = NodePath.join(packageDirectory, "package.json");
  const packageJson = JSON.parse(await NodeFSP.readFile(packageJsonPath, "utf8")) as Record<
    string,
    unknown
  >;
  delete packageJson.devDependencies;
  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
    const dependencies = packageJson[section];
    if (dependencies === null || typeof dependencies !== "object") continue;
    for (const [name, specifier] of Object.entries(dependencies as Record<string, unknown>)) {
      if (
        typeof specifier === "string" &&
        (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(specifier) ||
          specifier.startsWith("catalog:"))
      ) {
        (dependencies as Record<string, unknown>)[name] = installedPackageVersion(name);
      }
    }
  }
  await NodeFSP.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  const repacked = await run("npm", ["pack", "--json", "--pack-destination", artifacts], {
    cwd: packageDirectory,
  });
  const record = JSON.parse(String(repacked.stdout))[0] as { filename?: unknown } | undefined;
  if (typeof record?.filename !== "string")
    throw new Error("npm pack did not return an installable Kata tarball.");
  return NodePath.join(artifacts, NodePath.basename(record.filename));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function lockPackage(lock: Record<string, unknown>, path: string): Record<string, unknown> {
  const packages = lock.packages;
  if (packages === null || typeof packages !== "object") {
    throw new Error("The sandbox runtime lockfile has no packages section.");
  }
  const packageEntry = Reflect.get(packages, path);
  if (packageEntry === null || typeof packageEntry !== "object") {
    throw new Error(`The sandbox runtime lockfile is missing ${path}.`);
  }
  return packageEntry as Record<string, unknown>;
}

async function writeRuntimeInstallLock(
  artifacts: string,
  kataArchive: string,
  codexArchive: string,
): Promise<void> {
  const runtimePackage = {
    name: "kata-sandbox-runtime",
    private: true,
    dependencies: {
      "@kata-sh/code-cli": "file:./kata-code-cli.tgz",
      "@openai/codex": "file:./codex.tgz",
    },
  };
  await NodeFSP.writeFile(
    NodePath.join(artifacts, "package.json"),
    `${JSON.stringify(runtimePackage, null, 2)}\n`,
  );
  const lock = JSON.parse(
    await NodeFSP.readFile(NodePath.join(packageDirectory, "runtime-package-lock.json"), "utf8"),
  ) as Record<string, unknown>;
  const kataPackage = await packageJsonFromArchive(kataArchive);
  const codexPackage = await packageJsonFromArchive(codexArchive);
  const kataLock = lockPackage(lock, "node_modules/@kata-sh/code-cli");
  const codexLock = lockPackage(lock, "node_modules/@openai/codex");
  if (codexLock.version !== codexPackage.version) {
    throw new Error(
      `Update runtime-package-lock.json for ${String(codexPackage.name)}@${String(codexPackage.version)}.`,
    );
  }
  if (stableJson(kataLock.dependencies) !== stableJson(kataPackage.dependencies)) {
    throw new Error("Update runtime-package-lock.json for the Kata dependency graph.");
  }
  if (
    stableJson(codexLock.optionalDependencies) !== stableJson(codexPackage.optionalDependencies)
  ) {
    throw new Error("Update runtime-package-lock.json for the Codex dependency graph.");
  }
  kataLock.version = kataPackage.version;
  delete kataLock.integrity;
  delete codexLock.integrity;
  await NodeFSP.writeFile(
    NodePath.join(artifacts, "package-lock.json"),
    `${JSON.stringify(lock, null, 2)}\n`,
  );
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await NodeFSP.readFile(path, "utf8"));
}

function readSourceManifest(): SandboxSourceManifest {
  return decodeSandboxSourceManifest(JSON.parse(NodeFS.readFileSync(sourceManifestPath, "utf8")));
}

async function run(
  command: string,
  args: ReadonlyArray<string>,
  options: NodeChildProcess.ExecFileOptions = {},
) {
  return execFile(command, [...args], {
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

async function runStreaming(
  command: string,
  args: ReadonlyArray<string>,
  options: NodeChildProcess.SpawnOptions = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, [...args], {
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} exited with ${signal === null ? `code ${String(code)}` : `signal ${signal}`}.`,
        ),
      );
    });
  });
}

export function createImageBuildFacts(input: {
  readonly mode: ImageBuildFacts["mode"];
  readonly imageId?: string | undefined;
  readonly platform?: string | undefined;
  readonly platforms: ReadonlyArray<string>;
  readonly reference?: string | undefined;
  readonly tags: ReadonlyArray<string>;
  readonly indexDigest?: string | undefined;
  readonly sourceManifest: SandboxSourceManifest;
  readonly kataPackage: Record<string, unknown>;
  readonly kataArtifactSha256: string;
  readonly codexPackage: Record<string, unknown>;
  readonly codexArtifactSha256: string;
  readonly buildxMetadata: unknown;
}): ImageBuildFacts {
  const kataName = input.kataPackage.name;
  const kataVersion = input.kataPackage.version;
  const codexName = input.codexPackage.name;
  const codexVersion = input.codexPackage.version;
  if (kataName !== "@kata-sh/code-cli" || typeof kataVersion !== "string") {
    throw new Error("The packed Kata artifact is not @kata-sh/code-cli with a version.");
  }
  if (
    codexName !== input.sourceManifest.codex.package ||
    codexVersion !== input.sourceManifest.codex.version
  ) {
    throw new Error("The packed Codex artifact does not match source-manifest.json.");
  }
  const baseDigest = imageDigestFromReference(input.sourceManifest.baseImage);
  if (
    !/^[0-9a-f]{64}$/i.test(input.kataArtifactSha256) ||
    !/^[0-9a-f]{64}$/i.test(input.codexArtifactSha256)
  ) {
    throw new Error("Image artifact digests must be sha256 hex values.");
  }
  return {
    version: 1,
    mode: input.mode,
    ...(input.imageId === undefined ? {} : { imageId: input.imageId }),
    ...(input.platform === undefined ? {} : { platform: input.platform }),
    platforms: input.platforms,
    ...(input.reference === undefined ? {} : { reference: input.reference }),
    tags: input.tags,
    ...(input.indexDigest === undefined ? {} : { indexDigest: input.indexDigest }),
    baseImage: input.sourceManifest.baseImage,
    baseDigest,
    kataPackage: kataName,
    kataVersion,
    kataArtifactSha256: input.kataArtifactSha256,
    serverArtifactSha256: input.kataArtifactSha256,
    codexPackage: codexName,
    codexVersion,
    codexArtifactSha256: input.codexArtifactSha256,
    codexIntegrity: input.sourceManifest.codex.integrity,
    buildxMetadata: input.buildxMetadata,
  };
}

function validateLocalImageId(value: string): string {
  const imageId = value.trim();
  if (!isSha256Digest(imageId))
    throw new Error("Docker image inspect did not return an immutable image ID.");
  return imageId;
}

export async function runImageBuild(args = process.argv.slice(2)): Promise<ImageBuildFacts> {
  const options = parseImageBuildArgs(args);
  const sourceManifest = readSourceManifest();
  const imageTag =
    options.imageTag ?? process.env.KATACODE_SANDBOX_IMAGE_TAG?.trim() ?? "kata-sandbox-local";
  const tags = options.tags.length > 0 ? options.tags : [imageTag];
  const firstTag = tags[0];
  if (firstTag === undefined) throw new Error("At least one Docker image tag is required.");
  const reference = options.reference?.trim();
  if (options.push) {
    if (!reference) throw new Error("--reference is required when pushing an image.");
    validatePushedImageTags(reference, tags);
  }

  const context = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kata-sandbox-image-"));
  try {
    const artifacts = NodePath.join(context, "artifacts");
    const metadataPath = NodePath.join(context, "buildx-metadata.json");
    await NodeFSP.mkdir(artifacts, { recursive: true });
    await NodeFSP.cp(
      NodePath.join(packageDirectory, "bootstrap"),
      NodePath.join(context, "bootstrap"),
      {
        recursive: true,
      },
    );

    await run("vp", ["run", "--filter", "@kata-sh/code-cli", "build:bundle"], {
      cwd: repositoryRoot,
    });

    // npm pack fetches the exact version from the registry; the computed
    // integrity is compared with the reviewed source manifest before Docker runs.
    const packedCodex = await run(
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
    const codexRecord = JSON.parse(String(packedCodex.stdout))[0] as
      | { filename?: unknown }
      | undefined;
    if (typeof codexRecord?.filename !== "string")
      throw new Error("npm pack did not return a Codex tarball.");
    const downloadedCodex = NodePath.join(artifacts, NodePath.basename(codexRecord.filename));
    const codexPackage = await packageJsonFromArchive(downloadedCodex);
    if (
      codexPackage.name !== sourceManifest.codex.package ||
      codexPackage.version !== sourceManifest.codex.version
    ) {
      throw new Error(`Expected ${sourceManifest.codex.package}@${sourceManifest.codex.version}.`);
    }
    if (sha512Integrity(downloadedCodex) !== sourceManifest.codex.integrity) {
      throw new Error("The downloaded @openai/codex package does not match source-manifest.json.");
    }
    const codexArchive = NodePath.join(artifacts, "codex.tgz");
    await NodeFSP.rename(downloadedCodex, codexArchive);

    const packedKata = await run("npm", ["pack", "--json", "--pack-destination", artifacts], {
      cwd: NodePath.join(repositoryRoot, "apps/server"),
    });
    const kataRecord = JSON.parse(String(packedKata.stdout))[0] as
      | { filename?: unknown }
      | undefined;
    if (typeof kataRecord?.filename !== "string")
      throw new Error("npm pack did not return a Kata tarball.");
    const kataArchive = NodePath.join(artifacts, "kata-code-cli.tgz");
    const packedKataArchive = NodePath.join(artifacts, NodePath.basename(kataRecord.filename));
    const installableKataArchive = await makeInstallableKataArchive(
      packedKataArchive,
      artifacts,
      context,
    );
    await NodeFSP.copyFile(installableKataArchive, kataArchive);
    const kataPackage = JSON.parse(
      await NodeFSP.readFile(NodePath.join(repositoryRoot, "apps/server/package.json"), "utf8"),
    ) as Record<string, unknown>;
    const kataArtifactSha256 = sha256(kataArchive);
    const codexArtifactSha256 = sha256(codexArchive);
    await writeRuntimeInstallLock(artifacts, kataArchive, codexArchive);

    const platformValue = options.platforms
      ? options.platforms
      : String(
          (await run("docker", ["version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"])).stdout,
        ).trim();
    const platforms = normalizeDockerPlatforms(platformValue);
    const platform = platforms[0];
    if (platform === undefined)
      throw new Error("Docker platform resolution returned no platforms.");
    const dockerArgs = buildImageDockerArgs({
      platforms: platforms.join(","),
      push: options.push,
      tags,
      metadataPath,
      dockerfilePath: NodePath.join(packageDirectory, "Dockerfile"),
      contextPath: context,
      buildArgs: [
        `KATACODE_BASE_IMAGE=${sourceManifest.baseImage}`,
        `KATACODE_CLI_VERSION=${String(kataPackage.version ?? "")}`,
        `KATACODE_CLI_SHA256=${kataArtifactSha256}`,
        `KATACODE_CLI_PACKAGE=${String(kataPackage.name ?? "")}`,
        `CODEX_VERSION=${String(codexPackage.version ?? "")}`,
        `CODEX_SHA256=${codexArtifactSha256}`,
        `CODEX_PACKAGE=${String(codexPackage.name ?? "")}`,
      ],
    });
    await runStreaming("docker", dockerArgs, { cwd: repositoryRoot });

    const buildxMetadata = NodeFS.existsSync(metadataPath) ? await readJson(metadataPath) : {};
    const indexDigest = extractBuildxIndexDigest(buildxMetadata);
    let imageId: string | undefined;
    if (!options.push) {
      imageId = validateLocalImageId(
        String((await run("docker", ["image", "inspect", "--format", "{{.Id}}", firstTag])).stdout),
      );
    } else if (indexDigest === undefined) {
      throw new Error("Buildx metadata did not contain an immutable container image digest.");
    }

    const facts = createImageBuildFacts({
      mode: options.push ? "registry" : "local",
      imageId,
      platform: options.push ? undefined : platform,
      platforms,
      reference,
      tags,
      indexDigest,
      sourceManifest,
      kataPackage,
      kataArtifactSha256,
      codexPackage,
      codexArtifactSha256,
      buildxMetadata,
    });
    if (options.outputFile) {
      await NodeFSP.writeFile(options.outputFile, `${JSON.stringify(facts, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(facts)}\n`);
    return facts;
  } finally {
    await NodeFSP.rm(context, { recursive: true, force: true });
  }
}
