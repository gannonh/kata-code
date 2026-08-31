import { OciImageDigest } from "@kata-sh/code-kata-sandbox-contracts/domain";
import type { Sha256Digest } from "@kata-sh/code-kata-sandbox-contracts/domain";
import * as Schema from "effect/Schema";

export const SandboxSourceManifest = Schema.Struct({
  version: Schema.Literal(1),
  baseImage: OciImageDigest,
  codex: Schema.Struct({
    package: Schema.Literal("@openai/codex"),
    version: Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/)),
    integrity: Schema.String.check(Schema.isPattern(/^sha512-[A-Za-z0-9+/]+={0,2}$/)),
  }),
});
export type SandboxSourceManifest = typeof SandboxSourceManifest.Type;

export const decodeSandboxSourceManifest = Schema.decodeUnknownSync(SandboxSourceManifest);

export function isSandboxSourceManifest(value: unknown): value is SandboxSourceManifest {
  try {
    decodeSandboxSourceManifest(value);
    return true;
  } catch {
    return false;
  }
}

export type SandboxImageArtifactFacts = {
  readonly baseImage: SandboxSourceManifest["baseImage"];
  readonly kataArtifactSha256: Sha256Digest;
  readonly codexVersion: SandboxSourceManifest["codex"]["version"];
  readonly codexIntegrity: SandboxSourceManifest["codex"]["integrity"];
  readonly codexArtifactSha256: Sha256Digest;
};
