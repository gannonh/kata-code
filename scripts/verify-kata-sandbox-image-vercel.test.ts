// @effect-diagnostics nodeBuiltinImport:off globalDate:off - this is a guarded release-boundary test.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "@effect/vitest";

import { resolveVercelSandboxSmokeAuth } from "./vercel-sandbox-smoke-auth.ts";

const enabled = process.env.KATACODE_VERCEL_IMAGE_E2E === "1";
const artifactPath = process.env.KATACODE_SANDBOX_IMAGE_ARTIFACT ?? "sandbox-image.json";
const digestPattern = /^sha256:[0-9a-f]{64}$/i;

type SandboxCommandResult = {
  readonly exitCode: number;
  readonly stderr?: () => Promise<string>;
};

type SandboxHandle = {
  readonly runCommand: (input: {
    readonly cmd: string;
    readonly args?: ReadonlyArray<string>;
    readonly env?: Readonly<Record<string, string>>;
  }) => Promise<SandboxCommandResult>;
  readonly stop: () => Promise<unknown>;
  readonly delete: () => Promise<unknown>;
};

type SandboxSdk = {
  readonly Sandbox: {
    readonly create: (input: {
      readonly image: string;
      readonly persistent: false;
      readonly timeout: number;
      readonly token: string;
      readonly teamId: string;
      readonly projectId: string;
    }) => Promise<SandboxHandle>;
  };
};

async function loadSandboxSdk(): Promise<SandboxSdk> {
  const moduleName = "@vercel/sandbox";
  return (await import(moduleName)) as unknown as SandboxSdk;
}

function readArtifact(): {
  readonly immutableReference: string;
  readonly indexDigest: string;
  readonly platformDigests: {
    readonly "linux/amd64": string;
    readonly "linux/arm64": string;
  };
  readonly kataVersion: string;
  readonly kataArtifactSha256: string;
  readonly codexVersion: string;
  readonly codexArtifactSha256: string;
} {
  const value = JSON.parse(NodeFS.readFileSync(artifactPath, "utf8")) as Record<string, unknown>;
  const fields = [
    "immutableReference",
    "indexDigest",
    "kataVersion",
    "kataArtifactSha256",
    "codexVersion",
    "codexArtifactSha256",
  ] as const;
  for (const field of fields) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new Error(`Sandbox image artifact is missing ${field}.`);
    }
  }
  const platformDigests = value.platformDigests;
  if (
    platformDigests === null ||
    typeof platformDigests !== "object" ||
    !digestPattern.test(Reflect.get(platformDigests, "linux/amd64")) ||
    !digestPattern.test(Reflect.get(platformDigests, "linux/arm64"))
  ) {
    throw new Error("Sandbox image artifact is missing a platform digest.");
  }
  const immutableReference = value.immutableReference as string;
  const indexDigest = value.indexDigest as string;
  if (
    !digestPattern.test(indexDigest) ||
    !immutableReference.endsWith(`@${indexDigest}`) ||
    immutableReference.split("@").length !== 2
  ) {
    throw new Error("Sandbox image artifact has a mutable or inconsistent index reference.");
  }
  return {
    immutableReference,
    indexDigest,
    platformDigests: {
      "linux/amd64": Reflect.get(platformDigests, "linux/amd64") as string,
      "linux/arm64": Reflect.get(platformDigests, "linux/arm64") as string,
    },
    kataVersion: value.kataVersion as string,
    kataArtifactSha256: value.kataArtifactSha256 as string,
    codexVersion: value.codexVersion as string,
    codexArtifactSha256: value.codexArtifactSha256 as string,
  };
}

describe.runIf(enabled)("Vercel Sandbox managed image", () => {
  it(
    "runs the image verifier from the immutable multi-platform index",
    async () => {
      const artifact = readArtifact();
      const { Sandbox } = await loadSandboxSdk();
      const { token, teamId, projectId } = resolveVercelSandboxSmokeAuth(process.env);
      const sandbox = await Sandbox.create({
        image: artifact.immutableReference,
        persistent: false,
        timeout: 5 * 60 * 1000,
        token,
        teamId,
        projectId,
      });
      try {
        const manifest = JSON.stringify({
          version: 1,
          imageDigest: artifact.immutableReference,
          kataVersion: artifact.kataVersion,
          serverVersion: artifact.kataVersion,
          serverArtifactSha256: artifact.kataArtifactSha256,
          codexVersion: artifact.codexVersion,
          codexArtifactSha256: artifact.codexArtifactSha256,
        });
        const result = await sandbox.runCommand({
          cmd: "/usr/local/bin/kata-sandbox-entrypoint",
          args: ["true"],
          env: {
            KATACODE_SANDBOX_MANIFEST: manifest,
            KATACODE_SANDBOX_IMAGE_DIGEST: artifact.immutableReference,
            KATACODE_SANDBOX_RUNTIME_CHECK: "1",
          },
        });
        const stderr = result.stderr === undefined ? "" : await result.stderr();
        expect(result.exitCode, stderr).toBe(0);
      } finally {
        try {
          await sandbox.stop();
        } finally {
          await sandbox.delete();
        }
      }
    },
    10 * 60 * 1000,
  );
});
