import type { SandboxBootstrapManifest, SandboxProfile } from "@kata-sh/code-kata-sandbox-contracts/domain";
import type { SandboxBootstrapFacts } from "@kata-sh/code-kata-sandbox/driver";

export function buildSandboxBootstrapManifest(
  profile: SandboxProfile,
  facts: SandboxBootstrapFacts,
): SandboxBootstrapManifest {
  return {
    version: 1,
    imageDigest: profile.imageDigest,
    kataVersion: facts.kataVersion,
    serverVersion: facts.serverVersion,
    serverArtifactSha256: facts.serverArtifactSha256,
    codexVersion: facts.codexVersion,
    codexArtifactSha256: facts.codexArtifactSha256,
  };
}
