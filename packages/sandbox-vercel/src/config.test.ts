import { describe, expect, it } from "vite-plus/test";

import * as Schema from "effect/Schema";

import {
  VercelSandboxConfig,
  DEFAULT_VERCEL_CONFIG,
  VERCEL_AUTH_ENV_VARS,
  mergeVercelAuthIntoConfig,
} from "./config.ts";

const decodeConfig = Schema.decodeUnknownSync(VercelSandboxConfig);

describe("VercelSandboxConfig", () => {
  it("decodes a minimal config and round-trips the default", () => {
    const decoded = decodeConfig(DEFAULT_VERCEL_CONFIG);
    expect(decoded.runtime).toBe("node24");
    expect(decoded.sourceType).toBe("runtime");
    expect(decoded.timeoutMs).toBe(86_400_000);
    expect(decoded.port).toBe(13773);
  });

  it("rejects malformed config (bad port, unknown sourceType)", () => {
    expect(() => decodeConfig({ ...DEFAULT_VERCEL_CONFIG, port: 0 })).toThrow();
    expect(() => decodeConfig({ ...DEFAULT_VERCEL_CONFIG, sourceType: "vcr" })).toThrow();
  });

  it("VERCEL_AUTH_ENV_VARS lists the trio the server materializes", () => {
    expect([...VERCEL_AUTH_ENV_VARS]).toEqual([
      "VERCEL_TOKEN",
      "VERCEL_TEAM_ID",
      "VERCEL_PROJECT_ID",
    ]);
  });
});

describe("mergeVercelAuthIntoConfig", () => {
  const baseEnvelope = {
    driver: "vercel" as never,
    config: { ...DEFAULT_VERCEL_CONFIG },
  };

  it("injects the auth trio from instance environment into config.auth", () => {
    const merged = mergeVercelAuthIntoConfig({
      ...baseEnvelope,
      environment: [
        { name: "VERCEL_TOKEN", value: "tok", sensitive: true },
        { name: "VERCEL_TEAM_ID", value: "team_1", sensitive: true },
        { name: "VERCEL_PROJECT_ID", value: "prj_1", sensitive: true },
        { name: "KATACODE_PORT", value: "13773", sensitive: false },
      ],
    } as never);
    const config = merged.config as { auth?: { token: string; teamId: string; projectId: string } };
    expect(config.auth).toEqual({ token: "tok", teamId: "team_1", projectId: "prj_1" });
  });

  it("leaves config unchanged when any auth variable is missing", () => {
    const input = {
      ...baseEnvelope,
      environment: [
        { name: "VERCEL_TOKEN", value: "tok", sensitive: true },
        { name: "VERCEL_TEAM_ID", value: "", sensitive: true },
      ],
    } as never;
    const merged = mergeVercelAuthIntoConfig(input);
    // Unchanged means the config payload retains no `auth` key.
    expect((merged.config as { auth?: unknown }).auth).toBeUndefined();
    expect(merged).toEqual(input);
  });
});
