// @effect-diagnostics nodeBuiltinImport:off - tmp dir creation via node:fs/promises + node:path in tests; no Effect FileSystem service.
/* eslint-disable kata-code/no-manual-effect-runtime-in-tests -- reconcile integration tests use Effect.runPromise for simple async assertions. */
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as NodeFs from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOs from "node:os";

import { SandboxProviderDriverKind } from "@kata-sh/code-sandbox-contracts/instance";
import { SandboxReachabilityKind } from "@kata-sh/code-sandbox-contracts/reachability";
import {
  type SandboxHandle,
  type SandboxLifecycleStatus,
  type SandboxProvider,
  SandboxProviderError,
} from "@kata-sh/code-sandbox/driver";
import { SandboxProviderRegistry } from "@kata-sh/code-sandbox/registry";
import type { SandboxProviderDescriptor } from "@kata-sh/code-sandbox/descriptor";
import { SandboxProviderInstanceId } from "@kata-sh/code-contracts/sandboxProviderInstance";
import type { ServerSettings } from "@kata-sh/code-contracts";

import { makeSandboxSessionStore, type SandboxSessionRecord } from "./sandboxSessionStore.ts";
import {
  reconcileStoredRecords,
  discoverUntrackedSessions,
  cacheLiveSession,
  sanitizeHandleForStore,
  reinjectVercelAuth,
  connectAuthTokenPreferenceForEndpoint,
  type LiveSession,
} from "./SandboxService.ts";

/** Create a unique tmp dir for a store. */
async function tmpKatacodeHome(): Promise<string> {
  return NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-sandbox-reconcile-test-"));
}

const FAKE_KIND = SandboxProviderDriverKind.make("fake-lifecycle");

/** A fake driver with a controllable `lifecycle.status`. Records each status
 *  call so the test can assert reconcile queried the provider. */
function makeFakeDriver(
  statusFor: (instanceId: string) => SandboxLifecycleStatus,
  discoverFor?: (instanceId: string) => SandboxLifecycleStatus | null,
): {
  driver: SandboxProvider;
  statusCalls: string[];
  discoverCalls: string[];
} {
  const statusCalls: string[] = [];
  const discoverCalls: string[] = [];
  const descriptor: SandboxProviderDescriptor = {
    kind: FAKE_KIND,
    reachabilityKind: SandboxReachabilityKind.make("loopback"),
    supportsSnapshot: false,
    supportsRenewTimeout: false,
    supportsCopyInto: false,
    supportsLifecycle: true,
  };
  const driver: SandboxProvider = {
    kind: FAKE_KIND,
    validate: () => Effect.void,
    provision: (req) =>
      Effect.succeed({
        driverKind: FAKE_KIND,
        instanceId: req.instanceId,
        handle: { fake: true },
      }),
    exec: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
    reachability: (_h, port) =>
      Effect.succeed({
        reachabilityKind: SandboxReachabilityKind.make("loopback"),
        httpBaseUrl: `http://localhost:${port}`,
        wsBaseUrl: `ws://localhost:${port}`,
      }),
    dispose: () => Effect.void,
    describe: () => Effect.succeed(descriptor),
    lifecycle: {
      stop: () => Effect.void,
      start: (handle) => Effect.succeed(handle),
      status: (handle) => {
        statusCalls.push(handle.instanceId);
        return Effect.succeed(statusFor(handle.instanceId));
      },
      ...(discoverFor !== undefined
        ? {
            discover: (req) => {
              discoverCalls.push(req.instanceId);
              const status = discoverFor(req.instanceId);
              if (status === null) return Effect.succeed(null);
              return Effect.succeed({
                handle: {
                  driverKind: FAKE_KIND,
                  instanceId: req.instanceId,
                  handle: { fake: true, discovered: true },
                } satisfies SandboxHandle,
                status,
              });
            },
          }
        : {}),
    },
  };
  return { driver, statusCalls, discoverCalls };
}

/** Minimal ServerSettings with one fake instance. */
function settingsWithInstance(instanceId: string): ServerSettings {
  return {
    sandboxProviderInstances: {
      [SandboxProviderInstanceId.make(instanceId)]: {
        driver: FAKE_KIND,
        config: {},
      },
    } as never,
    savedSandboxEnvironments: {},
  } as unknown as ServerSettings;
}

function makeRecord(instanceId: string, status: "running" | "stopped"): SandboxSessionRecord {
  return {
    instanceId,
    driverKind: FAKE_KIND as string,
    environmentId: instanceId,
    sandboxEnvironmentId: `env_${instanceId}`,
    handle: { driverKind: FAKE_KIND as string, handle: { fake: true } },
    endpoint: { id: `sandbox-${instanceId}`, label: "Fake", httpBaseUrl: "http://localhost:1" },
    status,
  };
}

describe("Connect token selection for sandbox registration", () => {
  it("prefers the freshly supplied desktop token for loopback/Docker registration", () => {
    expect(connectAuthTokenPreferenceForEndpoint("cloudflare_tunnel" as never)).toBe(
      "provided-first",
    );
  });

  it("keeps the refreshable stored CLI token first for public/Vercel registration", () => {
    expect(connectAuthTokenPreferenceForEndpoint("manual" as never)).toBe("stored-first");
  });
});

describe("reconcileStoredRecords (AC-L7)", () => {
  it("reports running when the provider lifecycle.status returns running", async () => {
    const home = await tmpKatacodeHome();
    const store = makeSandboxSessionStore(home);
    await Effect.runPromise(store.upsert(makeRecord("fake_01", "running")));
    const { driver, statusCalls } = makeFakeDriver(() => "running");
    const registry = new SandboxProviderRegistry();
    registry.register(driver, () => ({}));
    const liveSessions = new Map<string, LiveSession>();

    const updated = await Effect.runPromise(
      reconcileStoredRecords({
        store,
        registry,
        settings: settingsWithInstance("fake_01"),
        liveSessions,
      }),
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]?.status).toBe("running");
    expect(updated[0]?.statusDetail).toBeUndefined();
    expect(statusCalls).toEqual(["fake_01"]);
    // The live session cache is populated for a kept record so providerLogin
    // can reach the driver (AC-L7 / review issue #9).
    expect(liveSessions.get("fake_01")?.driver).toBe(driver);
    // A fresh store instance (simulating a server restart) loads the reconciled record.
    const reloaded = await Effect.runPromise(makeSandboxSessionStore(home).load());
    expect(reloaded[0]?.status).toBe("running");
  });

  it("updates a stored running record to stopped when the provider reports stopped (Vercel timeout reconcile)", async () => {
    const home = await tmpKatacodeHome();
    const store = makeSandboxSessionStore(home);
    // A Vercel timeout in persistent mode leaves the provider reporting stopped;
    // the stored record was last-known running.
    await Effect.runPromise(store.upsert(makeRecord("fake_01", "running")));
    const { driver } = makeFakeDriver(() => "stopped");
    const registry = new SandboxProviderRegistry();
    registry.register(driver, () => ({}));

    const updated = await Effect.runPromise(
      reconcileStoredRecords({
        store,
        registry,
        settings: settingsWithInstance("fake_01"),
        liveSessions: new Map<string, LiveSession>(),
      }),
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]?.status).toBe("stopped");
    expect(updated[0]?.statusDetail).toBeUndefined();
  });

  it("keeps last-known status for skipInstanceIds without calling lifecycle.status", async () => {
    const home = await tmpKatacodeHome();
    const store = makeSandboxSessionStore(home);
    await Effect.runPromise(store.upsert(makeRecord("fake_01", "stopped")));
    const { driver, statusCalls } = makeFakeDriver(() => "running");
    const registry = new SandboxProviderRegistry();
    registry.register(driver, () => ({}));

    const updated = await Effect.runPromise(
      reconcileStoredRecords({
        store,
        registry,
        settings: settingsWithInstance("fake_01"),
        liveSessions: new Map<string, LiveSession>(),
        skipInstanceIds: new Set(["fake_01"]),
      }),
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]?.status).toBe("stopped");
    expect(statusCalls).toEqual([]);
  });

  it("preserves adminAccessToken across reconcile live-session cache updates", async () => {
    const home = await tmpKatacodeHome();
    const store = makeSandboxSessionStore(home);
    await Effect.runPromise(store.upsert(makeRecord("fake_01", "stopped")));
    const { driver } = makeFakeDriver(() => "running");
    const registry = new SandboxProviderRegistry();
    registry.register(driver, () => ({}));
    const liveSessions = new Map<string, LiveSession>();
    const handle: SandboxHandle = {
      driverKind: FAKE_KIND,
      instanceId: "fake_01",
      handle: { id: "h1" },
    };
    cacheLiveSession(liveSessions, "fake_01", {
      handle,
      driver,
      instanceConfig: { driver: "fake-lifecycle" } as never,
      environmentId: "env_1",
    });
    liveSessions.set("fake_01", {
      ...liveSessions.get("fake_01")!,
      adminAccessToken: "admin-token",
    });

    await Effect.runPromise(
      reconcileStoredRecords({
        store,
        registry,
        settings: settingsWithInstance("fake_01"),
        liveSessions,
      }),
    );

    expect(liveSessions.get("fake_01")?.adminAccessToken).toBe("admin-token");
    expect(liveSessions.get("fake_01")?.environmentId).toBe("env_fake_01");
  });

  it("evicts a record when the provider lifecycle.status returns gone", async () => {
    const home = await tmpKatacodeHome();
    const store = makeSandboxSessionStore(home);
    await Effect.runPromise(
      store.upsert({ ...makeRecord("gone_01", "running"), relay: { relayUrl: "https://r.test" } }),
    );
    const { driver } = makeFakeDriver(() => "gone");
    const registry = new SandboxProviderRegistry();
    registry.register(driver, () => ({}));

    const liveSessions = new Map<string, LiveSession>();
    const unlinked: string[] = [];

    const updated = await Effect.runPromise(
      reconcileStoredRecords({
        store,
        registry,
        settings: settingsWithInstance("gone_01"),
        liveSessions,
        unlinkRelay: (record) =>
          Effect.sync(() => {
            unlinked.push(record.sandboxEnvironmentId);
          }),
      }),
    );

    expect(updated).toHaveLength(0);
    // The store no longer holds the evicted record.
    const reloaded = await Effect.runPromise(makeSandboxSessionStore(home).load());
    expect(reloaded).toHaveLength(0);
    // A gone record is not cached (review issue #2): providerLogin cannot
    // operate on a sandbox the provider reports as gone.
    expect(liveSessions.get("gone_01")).toBeUndefined();
    // R3: gone eviction attempted the relay unlink.
    expect(unlinked).toEqual(["env_gone_01"]);
  });

  it("keeps the last-known status and sets statusDetail when reconcile fails", async () => {
    const home = await tmpKatacodeHome();
    const store = makeSandboxSessionStore(home);
    await Effect.runPromise(store.upsert(makeRecord("fake_01", "running")));
    // A driver whose lifecycle.status always fails (e.g. Vercel auth missing).
    const failingDriver: SandboxProvider = {
      ...makeFakeDriver(() => "running").driver,
      lifecycle: {
        stop: () => Effect.void,
        start: (h) => Effect.succeed(h),
        status: () =>
          Effect.fail(
            new SandboxProviderError({ reason: "invalid-config", message: "auth missing" }),
          ),
      },
    };
    const registry = new SandboxProviderRegistry();
    registry.register(failingDriver, () => ({}));

    const updated = await Effect.runPromise(
      reconcileStoredRecords({
        store,
        registry,
        settings: settingsWithInstance("fake_01"),
        liveSessions: new Map<string, LiveSession>(),
      }),
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]?.status).toBe("running"); // last-known kept
    expect(updated[0]?.statusDetail).toContain("auth missing");
  });

  it("evicts a record whose instance is no longer in settings", async () => {
    const home = await tmpKatacodeHome();
    const store = makeSandboxSessionStore(home);
    await Effect.runPromise(store.upsert(makeRecord("orphan_01", "running")));
    const { driver } = makeFakeDriver(() => "running");
    const registry = new SandboxProviderRegistry();
    registry.register(driver, () => ({}));
    // Settings with an empty instance map — the record's instance is gone.
    const emptySettings = {
      sandboxProviderInstances: {},
      savedSandboxEnvironments: {},
    } as unknown as ServerSettings;

    const updated = await Effect.runPromise(
      reconcileStoredRecords({
        store,
        registry,
        settings: emptySettings,
        liveSessions: new Map<string, LiveSession>(),
      }),
    );

    expect(updated).toHaveLength(0);
  });
});

describe("discoverUntrackedSessions (reconcile discovery)", () => {
  it("discovers a stopped sandbox for an instance with no store record and persists it", async () => {
    const home = await tmpKatacodeHome();
    const store = makeSandboxSessionStore(home);
    // No store record for fake_01, but the provider reports a stopped sandbox.
    const { driver, discoverCalls } = makeFakeDriver(
      () => "running",
      () => "stopped",
    );
    const registry = new SandboxProviderRegistry();
    registry.register(driver, () => ({}));
    const liveSessions = new Map<string, LiveSession>();

    await Effect.runPromise(
      discoverUntrackedSessions({
        store,
        registry,
        settings: settingsWithInstance("fake_01"),
        liveSessions,
      }),
    );

    expect(discoverCalls).toEqual(["fake_01"]);
    const reloaded = await Effect.runPromise(makeSandboxSessionStore(home).load());
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]?.instanceId).toBe("fake_01");
    expect(reloaded[0]?.status).toBe("stopped");
    // The live session is cached so stop/start/dispose can reach the driver.
    expect(liveSessions.get("fake_01")?.driver).toBe(driver);
  });

  it("does not persist when the provider reports no sandbox (discover returns null)", async () => {
    const home = await tmpKatacodeHome();
    const store = makeSandboxSessionStore(home);
    const { driver } = makeFakeDriver(
      () => "running",
      () => null,
    );
    const registry = new SandboxProviderRegistry();
    registry.register(driver, () => ({}));

    await Effect.runPromise(
      discoverUntrackedSessions({
        store,
        registry,
        settings: settingsWithInstance("fake_01"),
        liveSessions: new Map<string, LiveSession>(),
      }),
    );

    const reloaded = await Effect.runPromise(makeSandboxSessionStore(home).load());
    expect(reloaded).toHaveLength(0);
  });

  it("skips instances that already have a store record", async () => {
    const home = await tmpKatacodeHome();
    const store = makeSandboxSessionStore(home);
    await Effect.runPromise(store.upsert(makeRecord("fake_01", "running")));
    const { driver, discoverCalls } = makeFakeDriver(
      () => "running",
      () => "stopped",
    );
    const registry = new SandboxProviderRegistry();
    registry.register(driver, () => ({}));

    await Effect.runPromise(
      discoverUntrackedSessions({
        store,
        registry,
        settings: settingsWithInstance("fake_01"),
        liveSessions: new Map<string, LiveSession>(),
      }),
    );

    // Existing record is not re-discovered.
    expect(discoverCalls).toEqual([]);
    const reloaded = await Effect.runPromise(makeSandboxSessionStore(home).load());
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]?.status).toBe("running");
  });
});

describe("sanitizeHandleForStore / reinjectVercelAuth (no plaintext secrets)", () => {
  it("sanitizeHandleForStore strips auth from a Vercel handle but keeps the rest", () => {
    const vercelHandle = {
      sandboxId: "kata-inst-1",
      port: 13773,
      domainBase: "https://sb.vercel.run",
      timeoutMs: 86_400_000,
      auth: { token: "secret-token", teamId: "team_1", projectId: "prj_1" },
      persistent: true,
    };
    const sanitized = sanitizeHandleForStore("vercel", vercelHandle) as Record<string, unknown>;
    expect(sanitized.auth).toBeUndefined();
    expect(sanitized.sandboxId).toBe("kata-inst-1");
    expect(sanitized.port).toBe(13773);
    expect(sanitized.persistent).toBe(true);
  });

  it("sanitizeHandleForStore leaves non-vercel handles untouched", () => {
    const dockerHandle = {
      containerId: "c1",
      containerName: "kata-sandbox-x",
      hostPort: 1,
      containerPort: 13773,
    };
    expect(sanitizeHandleForStore("docker", dockerHandle)).toEqual(dockerHandle);
  });

  it("reinjectVercelAuth re-adds auth from the resolved config", () => {
    const sanitized = { sandboxId: "kata-inst-1", port: 13773, persistent: true };
    const config = {
      runtime: "node24",
      auth: { token: "tok", teamId: "team_1", projectId: "prj_1" },
    };
    const rehydrated = reinjectVercelAuth("vercel", sanitized, config) as Record<string, unknown>;
    expect(rehydrated.auth).toEqual({ token: "tok", teamId: "team_1", projectId: "prj_1" });
    expect(rehydrated.sandboxId).toBe("kata-inst-1");
  });

  it("reinjectVercelAuth leaves non-vercel handles untouched", () => {
    const handle = { containerId: "c1" };
    expect(reinjectVercelAuth("docker", handle, { auth: { token: "x" } })).toEqual(handle);
  });

  it("a Vercel handle round-trips through sanitize then reinject without leaking secrets to the store", async () => {
    const home = await tmpKatacodeHome();
    const store = makeSandboxSessionStore(home);
    const vercelHandle = {
      sandboxId: "kata-inst-1",
      port: 13773,
      domainBase: "https://sb.vercel.run",
      timeoutMs: 86_400_000,
      auth: { token: "secret-token", teamId: "team_1", projectId: "prj_1" },
      persistent: true,
    };
    const sanitized = sanitizeHandleForStore("vercel", vercelHandle);
    await Effect.runPromise(
      store.upsert({
        instanceId: "vercel_01",
        driverKind: "vercel",
        environmentId: "vercel_01",
        sandboxEnvironmentId: "env_v",
        handle: { driverKind: "vercel", handle: sanitized },
        endpoint: { id: "sb", label: "V", httpBaseUrl: "https://sb.vercel.run" },
        status: "running",
      }),
    );
    const file = NodePath.join(home, "sandbox-sessions.json");
    const raw = await NodeFs.readFile(file, "utf8");
    expect(raw).not.toContain("secret-token");
    expect(raw).not.toContain('"auth"');
    // Re-injection restores auth for the driver.
    const rehydrated = reinjectVercelAuth("vercel", sanitized, {
      auth: { token: "tok", teamId: "team_1", projectId: "prj_1" },
    }) as Record<string, unknown>;
    expect(rehydrated.auth).toEqual({ token: "tok", teamId: "team_1", projectId: "prj_1" });
  });
});
