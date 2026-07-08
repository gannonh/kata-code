// @effect-diagnostics nodeBuiltinImport:off - tmp dir creation via node:fs/promises + node:path in tests; no Effect FileSystem service.
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
      const storePath = NodePath.join(home, "userdata", "sandbox-sessions.json");
      await NodeFs.mkdir(NodePath.dirname(storePath), { recursive: true });
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
      const storePath = NodePath.join(home, "userdata", "sandbox-sessions.json");
      const raw = await NodeFs.readFile(storePath, "utf8");
      const parsed = JSON.parse(raw) as { records: SandboxSessionRecord[] };
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0]?.status).toBe("stopped");
      expect(parsed.records[0]?.statusDetail).toBe("auth missing");
    } finally {
      await NodeFs.rm(home, { recursive: true, force: true });
    }
  });
});
