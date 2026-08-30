import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { SandboxBootstrapManifest } from "./domain.js";

const decodeSandboxBootstrapManifest = Schema.decodeUnknownSync(SandboxBootstrapManifest);

describe("sandbox contracts", () => {
  it("accepts versioned immutable bootstrap manifests", () => {
    const manifest = decodeSandboxBootstrapManifest({
      version: 1,
      imageDigest: `kata-code@sha256:${"a".repeat(64)}`,
      kataVersion: "0.0.42",
      serverVersion: "0.0.42",
      serverArtifactSha256: "b".repeat(64),
      codexVersion: "0.1.0",
      codexArtifactSha256: "c".repeat(64),
    });

    expect(manifest.version).toBe(1);
    expect(manifest.imageDigest).toContain("@sha256:");
  });

  it("rejects mutable image references", () => {
    expect(() =>
      decodeSandboxBootstrapManifest({
        version: 1,
        imageDigest: "kata-code:latest",
        kataVersion: "0.0.42",
        serverVersion: "0.0.42",
        serverArtifactSha256: "b".repeat(64),
        codexVersion: "0.1.0",
        codexArtifactSha256: "c".repeat(64),
      }),
    ).toThrow();
  });
});
