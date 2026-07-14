// @effect-diagnostics nodeBuiltinImport:off - tmp dir creation via node:fs/promises + node:path in tests; no Effect FileSystem service.
// @effect-diagnostics globalConsole:off - per-entry eviction tests expect console.warn output from the store.
/* eslint-disable kata-code/no-manual-effect-runtime-in-tests -- store integration tests use Effect.runPromise for simple async assertions (vitIt.effect suite resolver is unavailable in this test runner config). */
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as NodeFs from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOs from "node:os";

import { makeSandboxSessionStore, type SandboxSessionRecord } from "./sandboxSessionStore.ts";

/** Create a unique tmp dir for a store. */
async function tmpKatacodeHome(): Promise<string> {
  return NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-sandbox-store-test-"));
}

/** A minimal valid record for tests. */
function makeRecord(overrides: Partial<SandboxSessionRecord> = {}): SandboxSessionRecord {
  return {
    instanceId: "docker_test_01",
    driverKind: "docker",
    environmentId: "docker_test_01",
    sandboxEnvironmentId: "env_abc",
    handle: {
      driverKind: "docker",
      handle: {
        containerId: "c1",
        containerName: "kata-sandbox-docker_test_01",
        hostPort: 32789,
        containerPort: 13773,
      },
    },
    endpoint: {
      id: "sandbox-docker_test_01",
      label: "Container test",
      httpBaseUrl: "http://localhost:32789",
    },
    status: "running",
    ...overrides,
  };
}

describe("SandboxSessionStore", () => {
  it("loads empty when no store file exists", async () => {
    const home = await tmpKatacodeHome();
    try {
      const store = makeSandboxSessionStore(home);
      const records = await Effect.runPromise(store.load());
      expect(records).toEqual([]);
    } finally {
      await NodeFs.rm(home, { recursive: true, force: true });
    }
  });

  it("persists a record and loads it back from a fresh store instance", async () => {
    const home = await tmpKatacodeHome();
    try {
      const store = makeSandboxSessionStore(home);
      await Effect.runPromise(store.upsert(makeRecord()));
      // A fresh store instance reads from disk.
      const store2 = makeSandboxSessionStore(home);
      const loaded = await Effect.runPromise(store2.load());
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.instanceId).toBe("docker_test_01");
      expect(loaded[0]?.status).toBe("running");
    } finally {
      await NodeFs.rm(home, { recursive: true, force: true });
    }
  });

  it("upsert replaces an existing record by instance id", async () => {
    const home = await tmpKatacodeHome();
    try {
      const store = makeSandboxSessionStore(home);
      await Effect.runPromise(store.upsert(makeRecord({ status: "running" })));
      await Effect.runPromise(store.upsert(makeRecord({ status: "stopped" })));
      const loaded = await Effect.runPromise(store.load());
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.status).toBe("stopped");
    } finally {
      await NodeFs.rm(home, { recursive: true, force: true });
    }
  });

  it("remove deletes a record by instance id and is a no-op when absent", async () => {
    const home = await tmpKatacodeHome();
    try {
      const store = makeSandboxSessionStore(home);
      await Effect.runPromise(store.upsert(makeRecord()));
      await Effect.runPromise(store.remove("docker_test_01" as never));
      const loaded = await Effect.runPromise(store.load());
      expect(loaded).toEqual([]);
      // No-op on absent record.
      await Effect.runPromise(store.remove("nonexistent" as never));
    } finally {
      await NodeFs.rm(home, { recursive: true, force: true });
    }
  });

  it("survives a corrupt JSON file by starting empty", async () => {
    const home = await tmpKatacodeHome();
    try {
      const storePath = NodePath.join(home, "sandbox-sessions.json");
      await NodeFs.mkdir(home, { recursive: true });
      await NodeFs.writeFile(storePath, "{not valid json", "utf8");
      const store = makeSandboxSessionStore(home);
      const records = await Effect.runPromise(store.load());
      expect(records).toEqual([]);
    } finally {
      await NodeFs.rm(home, { recursive: true, force: true });
    }
  });

  it("persisted file is valid JSON with the records array shape", async () => {
    const home = await tmpKatacodeHome();
    try {
      const store = makeSandboxSessionStore(home);
      await Effect.runPromise(
        store.upsert(makeRecord({ status: "stopped", statusDetail: "auth missing" })),
      );
      const storePath = NodePath.join(home, "sandbox-sessions.json");
      const raw = await NodeFs.readFile(storePath, "utf8");
      const parsed = JSON.parse(raw) as { records: SandboxSessionRecord[] };
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0]?.status).toBe("stopped");
      expect(parsed.records[0]?.statusDetail).toBe("auth missing");
    } finally {
      await NodeFs.rm(home, { recursive: true, force: true });
    }
  });

  it("persisted file contains no secrets (no auth/token/bearerToken) when a Vercel-style handle + relay is stored", async () => {
    const home = await tmpKatacodeHome();
    try {
      const store = makeSandboxSessionStore(home);
      // A Vercel-style handle that includes an auth trio — the store schema
      // accepts it (handle is Schema.Unknown), but the caller (storeSessionRecord)
      // is responsible for stripping auth. Here we verify the store itself does
      // not add secret fields to the relay schema (no bearerToken).
      await Effect.runPromise(
        store.upsert(
          makeRecord({
            driverKind: "vercel",
            handle: {
              driverKind: "vercel",
              // Simulate a sanitized handle (no auth) — what storeSessionRecord
              // should produce after the fix.
              handle: {
                sandboxId: "kata-vercel-test-01",
                port: 13773,
                domainBase: "https://sandbox.vercel.run",
                timeoutMs: 86_400_000,
                persistent: true,
              },
            },
            relay: { relayUrl: "https://relay.example.com" },
          }),
        ),
      );
      const storePath = NodePath.join(home, "sandbox-sessions.json");
      const raw = await NodeFs.readFile(storePath, "utf8");
      // The serialized file must not contain any secret field names.
      expect(raw).not.toContain("bearerToken");
      expect(raw).not.toContain('"token"');
      expect(raw).not.toContain('"auth"');
      expect(raw).not.toContain('"teamId"');
      expect(raw).not.toContain('"projectId"');
      // The relay must have relayUrl but no bearerToken.
      const parsed = JSON.parse(raw) as {
        records: Array<{ relay?: { relayUrl: string; bearerToken?: string } }>;
      };
      expect(parsed.records[0]?.relay?.relayUrl).toBe("https://relay.example.com");
      expect(parsed.records[0]?.relay?.bearerToken).toBeUndefined();
    } finally {
      await NodeFs.rm(home, { recursive: true, force: true });
    }
  });

  it("evicts invalid records individually while keeping valid ones (per-entry eviction)", async () => {
    const home = await tmpKatacodeHome();
    try {
      const storePath = NodePath.join(home, "sandbox-sessions.json");
      await NodeFs.mkdir(home, { recursive: true });
      // Write a file with one valid record and one invalid (missing required fields).
      const fileContents = JSON.stringify({
        records: [
          makeRecord({ instanceId: "valid_01" }),
          { instanceId: "broken_01", driverKind: "docker" /* missing required fields */ },
        ],
      });
      await NodeFs.writeFile(storePath, fileContents, "utf8");
      const store = makeSandboxSessionStore(home);
      const records = await Effect.runPromise(store.load());
      // The valid record survives; the invalid one is evicted.
      expect(records).toHaveLength(1);
      expect(records[0]?.instanceId).toBe("valid_01");
    } finally {
      await NodeFs.rm(home, { recursive: true, force: true });
    }
  });

  it("shares a cold load while a concurrent mutation preserves newer state", async () => {
    const home = await tmpKatacodeHome();
    try {
      const seedStore = makeSandboxSessionStore(home);
      await Effect.runPromise(seedStore.upsert(makeRecord({ instanceId: "seed" })));

      const store = makeSandboxSessionStore(home);
      const loadPromises = Array.from({ length: 8 }, () => Effect.runPromise(store.load()));
      const upsert = Effect.runPromise(store.upsert(makeRecord({ instanceId: "new" })));
      const loadedSnapshots = await Promise.all(loadPromises);
      await upsert;

      for (const snapshot of loadedSnapshots.slice(1)) {
        expect(snapshot).toBe(loadedSnapshots[0]);
      }
      expect(store.records.map((record) => record.instanceId).toSorted()).toEqual(["new", "seed"]);
      const reloaded = await Effect.runPromise(makeSandboxSessionStore(home).load());
      expect(reloaded.map((record) => record.instanceId).toSorted()).toEqual(["new", "seed"]);
    } finally {
      await NodeFs.rm(home, { recursive: true, force: true });
    }
  });

  it("serializes concurrent upserts without losing records or throwing ENOENT", async () => {
    const home = await tmpKatacodeHome();
    try {
      const store = makeSandboxSessionStore(home);
      await Effect.runPromise(
        Effect.all(
          [
            store.upsert(makeRecord({ instanceId: "a" })),
            store.upsert(makeRecord({ instanceId: "b" })),
            store.upsert(makeRecord({ instanceId: "c" })),
            store.upsert(makeRecord({ instanceId: "d" })),
          ],
          { concurrency: "unbounded" },
        ),
      );
      const loaded = await Effect.runPromise(store.load());
      expect(loaded.map((r) => r.instanceId).toSorted()).toEqual(["a", "b", "c", "d"]);
      const storePath = NodePath.join(home, "sandbox-sessions.json");
      const raw = await NodeFs.readFile(storePath, "utf8");
      expect(JSON.parse(raw).records).toHaveLength(4);
    } finally {
      await NodeFs.rm(home, { recursive: true, force: true });
    }
  });
});
