import { describe, expect, it, expectTypeOf } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { it as vitIt } from "@effect/vitest";

import {
  SandboxProviderDriverKind,
  SandboxProviderInstanceId,
  SandboxProviderInstanceConfigMap,
} from "@kata-sh/code-sandbox-contracts/instance";

import { SandboxProviderRegistry } from "./SandboxProviderRegistry.ts";
import type { SandboxProvider } from "./SandboxProviderDriver.ts";
import { createStubSandboxProvider, StubSandboxConfig } from "./testing/stubDriver.ts";

// Hoist compiled schema functions to module scope (kata-code/no-inline-schema-compile).
const decodeStubConfig = Schema.decodeUnknownSync(StubSandboxConfig);

const makeId = (s: string) => SandboxProviderInstanceId.make(s);
const stubConfigDecoder = (u: unknown) => decodeStubConfig(u);

const singleInstanceMap = (
  id: string,
  driver: string,
  overrides: Record<string, unknown> = {},
): SandboxProviderInstanceConfigMap =>
  ({
    [makeId(id)]: { driver: SandboxProviderDriverKind.make(driver), ...overrides },
  }) as unknown as SandboxProviderInstanceConfigMap;

describe("SandboxProviderRegistry materialization (AC-1.3)", () => {
  it("(a) a stub instance materializes as available", () => {
    const registry = new SandboxProviderRegistry();
    const stub = createStubSandboxProvider();
    registry.register(stub, stubConfigDecoder);
    const instances = registry.materialize(
      singleInstanceMap("my_stub", "stub", { config: { image: "node:20" } }),
    );
    expect(instances).toHaveLength(1);
    const inst = instances[0];
    expect(inst).toBeDefined();
    if (inst === undefined) return;
    expect(inst.kind).toBe("available");
    if (inst.kind === "available") {
      expect(inst.instanceId as string).toBe("my_stub");
      expect(inst.driver).toBe(stub);
      expect(inst.config).toEqual({ image: "node:20" });
    }
  });

  it("(b) an unknown-driver instance is unavailable with reason unknown-driver and does not throw", () => {
    const registry = new SandboxProviderRegistry();
    const map = singleInstanceMap("future", "some-future-driver", { config: {} });
    expect(() => registry.materialize(map)).not.toThrow();
    const inst = registry.materialize(map)[0];
    if (inst === undefined) return;
    expect(inst.kind).toBe("unavailable");
    if (inst.kind === "unavailable") expect(inst.reason).toBe("unknown-driver");
  });

  it("(c) a disabled instance is unavailable with reason disabled", () => {
    const registry = new SandboxProviderRegistry();
    registry.register(createStubSandboxProvider(), stubConfigDecoder);
    const inst = registry.materialize(
      singleInstanceMap("off", "stub", { enabled: false, config: {} }),
    )[0];
    if (inst === undefined) return;
    expect(inst.kind).toBe("unavailable");
    if (inst.kind === "unavailable") expect(inst.reason).toBe("disabled");
  });

  it("(d) an instance whose config fails the stub's decode is unavailable with reason invalid-config", () => {
    const registry = new SandboxProviderRegistry();
    registry.register(createStubSandboxProvider(), stubConfigDecoder);
    const inst = registry.materialize(
      singleInstanceMap("bad", "stub", { config: ["not", "a", "struct"] }),
    )[0];
    if (inst === undefined) return;
    expect(inst.kind).toBe("unavailable");
    if (inst.kind === "unavailable") {
      expect(inst.reason).toBe("invalid-config");
      expect(inst.message).toContain("bad");
    }
  });

  it("get returns undefined for an absent instance id", () => {
    const registry = new SandboxProviderRegistry();
    expect(
      registry.get({} as unknown as SandboxProviderInstanceConfigMap, makeId("nope")),
    ).toBeUndefined();
  });
});

describe("describe() capability flags match method presence (AC-1.5)", () => {
  vitIt.effect(
    "supportsSnapshot is true only when createSnapshot AND deleteSnapshot AND snapshotExists are all present",
    () =>
      Effect.gen(function* () {
        const withSnap = createStubSandboxProvider({ withSnapshot: true });
        const withoutSnap = createStubSandboxProvider({ withSnapshot: false });
        const dWith = yield* withSnap.describe();
        const dWithout = yield* withoutSnap.describe();
        expect(dWith.supportsSnapshot).toBe(true);
        expect(dWithout.supportsSnapshot).toBe(false);
        expect(withSnap.snapshot !== undefined).toBe(true);
        expect(withoutSnap.snapshot === undefined).toBe(true);
        expect(
          withSnap.snapshot !== undefined &&
            withSnap.snapshot.createSnapshot !== undefined &&
            withSnap.snapshot.deleteSnapshot !== undefined &&
            withSnap.snapshot.snapshotExists !== undefined,
        ).toBe(dWith.supportsSnapshot);
      }),
  );

  vitIt.effect("supportsRenewTimeout is true only when renewTimeout is present", () =>
    Effect.gen(function* () {
      const withRenew = createStubSandboxProvider({ withRenewTimeout: true });
      const withoutRenew = createStubSandboxProvider({ withRenewTimeout: false });
      const dWith = yield* withRenew.describe();
      const dWithout = yield* withoutRenew.describe();
      expect(dWith.supportsRenewTimeout).toBe(true);
      expect(dWithout.supportsRenewTimeout).toBe(false);
      expect(withRenew.renewTimeout !== undefined).toBe(dWith.supportsRenewTimeout);
      expect(withoutRenew.renewTimeout === undefined).toBe(true);
    }),
  );
});

describe("SPI freeze drift guard (AC-1.6)", () => {
  it("the stub satisfies the SandboxProvider interface (type-level conformance)", () => {
    const provider: SandboxProvider = createStubSandboxProvider();
    expect(typeof provider.kind).toBe("string");
    expect(typeof provider.validate).toBe("function");
    expect(typeof provider.provision).toBe("function");
    expect(typeof provider.exec).toBe("function");
    expect(typeof provider.reachability).toBe("function");
    expect(typeof provider.dispose).toBe("function");
    expect(typeof provider.describe).toBe("function");
    expectTypeOf<SandboxProvider>().toMatchTypeOf<SandboxProvider>();
  });
});
