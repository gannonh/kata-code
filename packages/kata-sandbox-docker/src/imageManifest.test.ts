import { describe, expect, it } from "@effect/vitest";

import { decodeSandboxSourceManifest, isSandboxSourceManifest } from "./imageManifest.ts";

const validManifest = {
  version: 1,
  baseImage: "docker.io/library/node:24-bookworm-slim@sha256:" + "a".repeat(64),
  codex: {
    package: "@openai/codex",
    version: "0.151.0",
    integrity: "sha512-" + "a".repeat(86) + "==",
  },
};

describe("SandboxSourceManifest", () => {
  it("accepts pinned image and package provenance", () => {
    expect(isSandboxSourceManifest(validManifest)).toBe(true);
    expect(decodeSandboxSourceManifest(validManifest)).toEqual(validManifest);
  });

  it("rejects mutable image references", () => {
    expect(isSandboxSourceManifest({ ...validManifest, baseImage: "node:24" })).toBe(false);
  });

  it("rejects a package without npm integrity", () => {
    expect(
      isSandboxSourceManifest({
        ...validManifest,
        codex: { ...validManifest.codex, integrity: "sha1-invalid" },
      }),
    ).toBe(false);
  });
});
