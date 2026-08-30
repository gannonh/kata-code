import type {
  SandboxBootstrapManifest,
  SandboxProfile,
} from "@kata-sh/code-kata-sandbox-contracts/domain";

import packageJson from "../../package.json" with { type: "json" };

function requiredArtifactValue(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${name} must contain the SHA-256 digest of the packaged artifact.`);
  }
  return value;
}

function requiredVersion(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must identify the packaged CLI version.`);
  }
  return value;
}

export function buildSandboxBootstrapManifest(profile: SandboxProfile): SandboxBootstrapManifest {
  const serverVersion = packageJson.version;
  const serverArtifactSha256 = requiredArtifactValue("KATACODE_SANDBOX_SERVER_ARTIFACT_SHA256");
  const codexVersion = requiredVersion("KATACODE_SANDBOX_CODEX_VERSION");
  const codexArtifactSha256 = requiredArtifactValue("KATACODE_SANDBOX_CODEX_ARTIFACT_SHA256");

  return {
    version: 1,
    imageDigest: profile.imageDigest,
    kataVersion: serverVersion,
    serverVersion,
    serverArtifactSha256,
    codexVersion,
    codexArtifactSha256,
  };
}
