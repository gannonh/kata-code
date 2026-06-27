import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ServerSettings, ServerSettingsPatch } from "./settings.ts";
import {
  SandboxProviderInstanceConfigMap,
  SandboxProviderInstanceId,
  SandboxProviderDriverKind,
  isSandboxProviderDriverKind,
  defaultInstanceIdForSandboxDriver,
} from "./sandboxProviderInstance.ts";

// Hoist compiled schema functions to module scope (kata-code/no-inline-schema-compile).
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeSettings = Schema.encodeSync(ServerSettings);
const decodeConfigMap = Schema.decodeUnknownSync(SandboxProviderInstanceConfigMap);

describe("ServerSettings.sandboxProviderInstances", () => {
  it("defaults to an empty record so configs without the key still decode (AC-1.4)", () => {
    const decoded = decodeServerSettings({});
    expect(decoded.sandboxProviderInstances).toEqual({});
  });

  it("round-trips a valid-but-unregistered driver kind with no data loss (AC-1.2)", () => {
    // A well-formed slug the registry does not know about. Decoding must
    // succeed and the envelope must round-trip verbatim (encode∘decode identity).
    const raw = {
      sandboxProviderInstances: {
        my_box: {
          driver: "some-future-driver",
          displayName: "My future box",
          enabled: true,
          config: { region: "eu-west-1", nested: { a: [1, 2, 3] } },
          environment: [{ name: "API_KEY", value: "secret", sensitive: true }],
        },
      },
    };
    const decoded = decodeServerSettings(raw);
    const instance = decoded.sandboxProviderInstances[SandboxProviderInstanceId.make("my_box")];
    expect(instance).toBeDefined();
    if (instance === undefined) return;
    expect(instance.driver).toBe("some-future-driver");
    // Unknown driver slug survives as a branded slug value.
    expect(isSandboxProviderDriverKind(instance.driver)).toBe(true);
    expect(instance.displayName).toBe("My future box");
    expect(instance.config).toEqual({ region: "eu-west-1", nested: { a: [1, 2, 3] } });
    // Re-encoding is identity for the map.
    const reencoded = encodeSettings(decoded);
    expect(reencoded.sandboxProviderInstances?.my_box).toEqual(raw.sandboxProviderInstances.my_box);
  });

  it("treats sandboxProviderInstances as an optional whole-map replacement in the patch", () => {
    expect(decodePatch({}).sandboxProviderInstances).toBeUndefined();
    const patched = decodePatch({
      sandboxProviderInstances: {
        docker_default: { driver: "docker", config: { image: "node:20" } },
      },
    });
    expect(patched.sandboxProviderInstances).toBeDefined();
    expect(
      patched.sandboxProviderInstances?.[SandboxProviderInstanceId.make("docker_default")]?.driver,
    ).toBe("docker");
  });

  it("rejects a malformed slug (schema rejection, distinct from unknown-driver)", () => {
    expect(() =>
      decodeServerSettings({
        sandboxProviderInstances: { "1bad": { driver: "docker" } },
      }),
    ).toThrow();
  });
});

describe("SandboxProviderInstanceConfigMap", () => {
  it("decodes the empty map", () => {
    expect(decodeConfigMap({})).toEqual({});
  });

  it("defaultInstanceIdForSandboxDriver mirrors the provider helper", () => {
    const kind = SandboxProviderDriverKind.make("docker");
    const id = defaultInstanceIdForSandboxDriver(kind);
    expect(id as string).toBe("docker");
    // Compile-time brand distinctness from ProviderInstanceId is verified by
    // the type system (assigning `id` to a ProviderInstanceId fails to compile);
    // runtime brand equality is not asserted here because effect brands are
    // phantom at runtime.
  });
});
