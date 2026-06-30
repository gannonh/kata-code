import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ServerSettings, ServerSettingsPatch } from "./settings.ts";
import {
  RepositoryCanonicalKey,
  SavedSandboxEnvironmentMap,
  SavedSandboxEnvironment,
} from "./savedSandboxEnvironment.ts";

// Hoist compiled schema functions to module scope (kata-code/no-inline-schema-compile).
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeSettings = Schema.encodeSync(ServerSettings);
const decodeMap = Schema.decodeUnknownSync(SavedSandboxEnvironmentMap);

describe("ServerSettings.savedSandboxEnvironments", () => {
  it("defaults to an empty record so configs without the key still decode (AC-2.5)", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.savedSandboxEnvironments).toEqual({});
  });

  it("round-trips a valid saved environment (install/start/terminals/networkAccess/sensitive env) with no data loss (AC-2.5)", () => {
    const raw = {
      savedSandboxEnvironments: {
        "github.com/octocat/kata-code": {
          install: "pnpm i",
          start: "pnpm dev",
          terminals: [{ name: "web", command: "pnpm web" }],
          networkAccess: "public",
          environment: [{ name: "API_KEY", value: "secret", sensitive: true }],
        },
      },
    };
    const decoded = decodeServerSettings(raw);
    const key = RepositoryCanonicalKey.make("github.com/octocat/kata-code");
    const entry = decoded.savedSandboxEnvironments[key];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(entry.install).toBe("pnpm i");
    expect(entry.start).toBe("pnpm dev");
    expect(entry.terminals).toEqual([{ name: "web", command: "pnpm web" }]);
    expect(entry.networkAccess).toBe("public");
    expect(entry.environment).toEqual([{ name: "API_KEY", value: "secret", sensitive: true }]);
    // Re-encoding is identity for the map.
    const reencoded = encodeSettings(decoded);
    expect(reencoded.savedSandboxEnvironments?.["github.com/octocat/kata-code"]).toEqual(
      raw.savedSandboxEnvironments["github.com/octocat/kata-code"],
    );
  });

  it("treats savedSandboxEnvironments as an optional whole-map replacement in the patch (AC-2.5)", () => {
    expect(decodePatch({}).savedSandboxEnvironments).toBeUndefined();
    const patched = decodePatch({
      savedSandboxEnvironments: {
        "github.com/octocat/kata-code": { install: "pnpm i" },
      },
    });
    expect(patched.savedSandboxEnvironments).toBeDefined();
    expect(
      patched.savedSandboxEnvironments?.[
        RepositoryCanonicalKey.make("github.com/octocat/kata-code")
      ]?.install,
    ).toBe("pnpm i");
  });

  it("rejects a malformed (empty/whitespace) canonical key (AC-2.5)", () => {
    expect(() =>
      decodeServerSettings({
        savedSandboxEnvironments: { "   ": { install: "pnpm i" } },
      }),
    ).toThrow();
  });
});

describe("SavedSandboxEnvironmentMap", () => {
  it("decodes the empty map", () => {
    expect(decodeMap({})).toEqual({});
  });

  it("RepositoryCanonicalKey is a distinct branded key", () => {
    const key = RepositoryCanonicalKey.make("github.com/octocat/kata-code");
    expect(key as string).toBe("github.com/octocat/kata-code");
    // Compile-time brand distinctness from SandboxProviderInstanceId /
    // ProviderInstanceId is verified by the type system (assigning `key` to
    // either fails to compile); runtime brand equality is not asserted because
    // effect brands are phantom at runtime.
    expect(SavedSandboxEnvironment).toBeDefined();
  });
});
