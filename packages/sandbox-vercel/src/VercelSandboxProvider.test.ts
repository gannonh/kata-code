import { describe, expect, it } from "vite-plus/test";
import { it as vitIt } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { SandboxProvider } from "@kata-sh/code-sandbox/driver";

import { makeVercelSandboxProvider } from "./VercelSandboxProvider.ts";
import type { VercelAuthParams, VercelSandboxInstance, VercelSdk } from "./sdk.ts";
import { DEFAULT_VERCEL_CONFIG } from "./config.ts";

const AUTH: VercelAuthParams = { token: "tok", teamId: "team_1", projectId: "prj_1" };

/** Provider factory with a healthz probe that always succeeds (no network). */
function makeProvider(sdk: VercelSdk): SandboxProvider {
  return makeVercelSandboxProvider(sdk, { healthzProbe: () => Effect.succeed(true) });
}

interface FakeRun {
  readonly cmd: string;
  readonly args?: ReadonlyArray<string>;
  readonly detached?: boolean;
}

interface FakeSdkState {
  createCalls: Array<unknown>;
  getCalls: Array<{ sandboxId: string; resume?: boolean }>;
  probeCalls: number;
  runCommands: FakeRun[];
  deleted: string[];
  extendTimeouts: Array<{ sandboxId: string; deltaMs: number }>;
  snapshotCalls: Array<{ sandboxId: string; expiration?: number }>;
  snapshots: Map<string, { status: string }>;
  /** Names stopped via `lifecycle.stop`. */
  stoppedNames: Set<string>;
  /** Per-name status override (default "running"). */
  statusByName: Map<string, string>;
  /** Per-name persistent flag (default true). */
  persistentByName: Map<string, boolean>;
  /** `update` calls recorded for assertions. */
  updateCalls: Array<{ sandboxId: string; persistent?: boolean }>;
  /** Fail the next `get` with a not-found error. */
  failGetNotFound: boolean;
}

function fakeSdk(
  overrides: Partial<{
    domain: string;
    snapshotStatus: string;
    runExitCode: number;
    runStderr: string;
    writeFilesOk: boolean;
  }> = {},
): { sdk: VercelSdk; state: FakeSdkState } {
  const domain = overrides.domain ?? "https://sandbox-abc.vercel.run";
  const state: FakeSdkState = {
    createCalls: [],
    getCalls: [],
    probeCalls: 0,
    runCommands: [],
    deleted: [],
    extendTimeouts: [],
    snapshotCalls: [],
    snapshots: new Map(),
    stoppedNames: new Set(),
    statusByName: new Map(),
    persistentByName: new Map(),
    updateCalls: [],
    failGetNotFound: false,
  };

  const makeInstance = (sandboxId: string): VercelSandboxInstance => ({
    sandboxId,
    domain: () => domain,
    get status() {
      return state.statusByName.get(sandboxId) ?? "running";
    },
    get persistent() {
      return state.persistentByName.get(sandboxId) ?? true;
    },
    runCommand: async (opts) => {
      state.runCommands.push({
        cmd: opts.cmd,
        ...(opts.args !== undefined ? { args: opts.args } : {}),
        ...(opts.detached !== undefined ? { detached: opts.detached } : {}),
      });
      return {
        exitCode: overrides.runExitCode ?? 0,
        stdout: async () => "",
        stderr: async () => overrides.runStderr ?? "",
      };
    },
    writeFiles: async () => {
      if (overrides.writeFilesOk === false) throw new Error("writeFiles failed");
    },
    extendTimeout: async (deltaMs) => {
      state.extendTimeouts = [...state.extendTimeouts, { sandboxId, deltaMs }];
    },
    snapshot: async (opts) => {
      state.snapshotCalls = [
        ...state.snapshotCalls,
        { sandboxId, ...(opts?.expiration !== undefined ? { expiration: opts.expiration } : {}) },
      ];
      const id = `snap_${state.snapshotCalls.length}`;
      state.snapshots.set(id, { status: overrides.snapshotStatus ?? "created" });
      return { snapshotId: id };
    },
    stop: async () => {
      state.stoppedNames.add(sandboxId);
      state.statusByName.set(sandboxId, "stopped");
    },
    delete: async () => {
      state.deleted = [...state.deleted, sandboxId];
    },
    update: async (params) => {
      state.updateCalls = [
        ...state.updateCalls,
        {
          sandboxId,
          ...(params.persistent !== undefined ? { persistent: params.persistent } : {}),
        },
      ];
      if (params.persistent !== undefined) state.persistentByName.set(sandboxId, params.persistent);
    },
  });

  const sdk: VercelSdk = {
    create: async (params) => {
      state.createCalls = [...state.createCalls, params];
      return makeInstance("sandbox-1");
    },
    get: async (params) => {
      state.getCalls = [
        ...state.getCalls,
        {
          sandboxId: params.sandboxId,
          ...(params.resume !== undefined ? { resume: params.resume } : {}),
        },
      ];
      if (state.failGetNotFound) {
        const err = new Error("not_found") as Error & { response?: { status: number } };
        err.response = { status: 404 };
        throw err;
      }
      return makeInstance(params.sandboxId);
    },
    listProjectsProbe: async () => {
      state.probeCalls += 1;
    },
    getSnapshot: async (params) => {
      const snap = state.snapshots.get(params.snapshotId);
      if (snap === undefined) return null;
      return {
        status: snap.status,
        delete: async () => {
          state.snapshots.delete(params.snapshotId);
        },
      };
    },
  };

  return { sdk, state };
}

const configWithAuth = (
  overrides: Partial<{
    persistent: boolean;
  }> = {},
) => ({
  ...DEFAULT_VERCEL_CONFIG,
  auth: AUTH,
  ...(overrides.persistent !== undefined ? { persistent: overrides.persistent } : {}),
});

/** Collapse an effect's error channel into a `{ _tag: "Left"|"Right" }` value (Effect v4 has no `Effect.either`). */
const either = <A, E>(
  eff: Effect.Effect<A, E>,
): Effect.Effect<{ _tag: "Left"; left: E } | { _tag: "Right"; right: A }, never> =>
  Effect.matchEffect(eff, {
    onFailure: (left) => Effect.succeed<{ _tag: "Left"; left: E }>({ _tag: "Left", left }),
    onSuccess: (right) => Effect.succeed<{ _tag: "Right"; right: A }>({ _tag: "Right", right }),
  });

describe("VercelSandboxProvider", () => {
  it("satisfies the SandboxProvider SPI at the type level (AC-3b.1)", () => {
    const { sdk } = fakeSdk();
    const provider: SandboxProvider = makeProvider(sdk);
    expect(provider.kind as string).toBe("vercel");
    expect(typeof provider.validate).toBe("function");
    expect(typeof provider.provision).toBe("function");
    expect(typeof provider.exec).toBe("function");
    expect(typeof provider.reachability).toBe("function");
    expect(typeof provider.dispose).toBe("function");
    expect(typeof provider.describe).toBe("function");
    expect(provider.snapshot).toBeUndefined();
    expect(provider.renewTimeout).toBeDefined();
    expect(provider.copyInto).toBeDefined();
    expect(provider.lifecycle).toBeDefined();
  });

  vitIt.effect("validate fails invalid-config without auth", () =>
    Effect.gen(function* () {
      const { sdk } = fakeSdk();
      const provider = makeProvider(sdk);
      const result = yield* either(provider.validate({ ...DEFAULT_VERCEL_CONFIG }));
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") expect(result.left.reason).toBe("invalid-config");
    }),
  );

  vitIt.effect("validate succeeds with auth (no snapshot validation)", () =>
    Effect.gen(function* () {
      const { sdk, state } = fakeSdk();
      const provider = makeProvider(sdk);
      const result = yield* either(provider.validate(configWithAuth()));
      expect(result._tag).toBe("Right");
      expect(state.probeCalls).toBe(1);
    }),
  );

  vitIt.effect("provision creates from runtime and runs the bootstrap script", () =>
    Effect.gen(function* () {
      const { sdk, state } = fakeSdk();
      const provider = makeProvider(sdk);
      const handle = yield* provider.provision({
        instanceId: "inst_1",
        config: configWithAuth(),
        image: "",
        env: [
          ["VERCEL_TOKEN", "tok"],
          ["KATACODE_DESKTOP_BOOTSTRAP_TOKEN", "bt"],
          ["FOO", "bar"],
        ],
      });
      expect(state.createCalls).toHaveLength(1);
      const bootstrapRun = state.runCommands.find((r) =>
        r.args?.join(" ")?.includes("npm install -g"),
      );
      expect(bootstrapRun).toBeDefined();
      const serveRun = state.runCommands.find((r) => r.detached === true);
      expect(serveRun).toBeDefined();
      expect(serveRun?.args?.join(" ")).toContain("katacode serve");
      const hstate = handle.handle as {
        sandboxId: string;
        port: number;
        domainBase: string;
        persistent: boolean;
      };
      // Deterministic name derived from the instance id (AC-L2).
      expect(hstate.sandboxId).toBe("kata-inst-1");
      expect(hstate.port).toBe(13773);
      expect(hstate.domainBase).toMatch(/^https:\/\//);
      expect(hstate.persistent).toBe(true);
    }),
  );

  vitIt.effect(
    "provision passes a deterministic name + persistence + keepLastSnapshots (AC-L2/L4)",
    () =>
      Effect.gen(function* () {
        const { sdk, state } = fakeSdk();
        const provider = makeProvider(sdk);
        yield* provider.provision({
          instanceId: "inst_1",
          config: configWithAuth(),
          image: "",
          env: [],
        });
        const createCall = state.createCalls[0] as {
          name?: string;
          persistent?: boolean;
          keepLastSnapshots?: { count: number };
          runtime?: string;
        };
        expect(createCall.name).toBe("kata-inst-1");
        expect(createCall.persistent).toBe(true);
        expect(createCall.keepLastSnapshots).toEqual({ count: 1 });
        expect(createCall.runtime).toBe("node24");
      }),
  );

  vitIt.effect("two provisions for the same instance reuse the same sandbox name (AC-L2)", () =>
    Effect.gen(function* () {
      const { sdk, state } = fakeSdk();
      const provider = makeProvider(sdk);
      yield* provider.provision({
        instanceId: "inst_1",
        config: configWithAuth(),
        image: "",
        env: [],
      });
      yield* provider.provision({
        instanceId: "inst_1",
        config: configWithAuth(),
        image: "",
        env: [],
      });
      const names = (state.createCalls as Array<{ name?: string }>).map((c) => c.name);
      expect(names).toEqual(["kata-inst-1", "kata-inst-1"]);
    }),
  );

  vitIt.effect("provision excludes VERCEL_TOKEN/TEAM_ID/PROJECT_ID from sandbox env", () =>
    Effect.gen(function* () {
      const { sdk, state } = fakeSdk();
      const provider = makeProvider(sdk);
      yield* provider.provision({
        instanceId: "inst_1",
        config: configWithAuth(),
        image: "",
        env: [
          ["VERCEL_TOKEN", "tok"],
          ["VERCEL_TEAM_ID", "team_1"],
          ["VERCEL_PROJECT_ID", "prj_1"],
          ["KATACODE_DESKTOP_BOOTSTRAP_TOKEN", "bt"],
        ],
      });
      const createCall = state.createCalls[0] as { env: Record<string, string> };
      expect(createCall.env["VERCEL_TOKEN"]).toBeUndefined();
      expect(createCall.env["VERCEL_TEAM_ID"]).toBeUndefined();
      expect(createCall.env["VERCEL_PROJECT_ID"]).toBeUndefined();
      expect(createCall.env["KATACODE_DESKTOP_BOOTSTRAP_TOKEN"]).toBe("bt");
      expect(createCall.env["KATACODE_HOST"]).toBe("0.0.0.0");
    }),
  );

  vitIt.effect("reachability maps domain to https/wss public URLs (AC-3b.4)", () =>
    Effect.gen(function* () {
      const { sdk } = fakeSdk({ domain: "https://sandbox-xyz.vercel.run" });
      const provider = makeProvider(sdk);
      const handle = yield* provider.provision({
        instanceId: "inst_1",
        config: configWithAuth(),
        image: "",
        env: [],
      });
      const reach = yield* provider.reachability(handle, 13773);
      expect(reach.reachabilityKind).toBe("public");
      expect(reach.httpBaseUrl).toBe("https://sandbox-xyz.vercel.run");
      expect(reach.wsBaseUrl).toBe("wss://sandbox-xyz.vercel.run");
    }),
  );

  vitIt.effect("renewTimeout forwards the delta to extendTimeout", () =>
    Effect.gen(function* () {
      const { sdk, state } = fakeSdk();
      const provider = makeProvider(sdk);
      const handle = yield* provider.provision({
        instanceId: "inst_1",
        config: configWithAuth(),
        image: "",
        env: [],
      });
      yield* provider.renewTimeout!.renewTimeout(handle, 60_000);
      expect(state.extendTimeouts).toEqual([{ sandboxId: "kata-inst-1", deltaMs: 60_000 }]);
    }),
  );

  vitIt.effect("dispose deletes and tolerates already-deleted (404)", () =>
    Effect.gen(function* () {
      const { sdk, state } = fakeSdk();
      const provider = makeProvider(sdk);
      const handle = yield* provider.provision({
        instanceId: "inst_1",
        config: configWithAuth(),
        image: "",
        env: [],
      });
      yield* provider.dispose(handle);
      expect(state.deleted).toEqual(["kata-inst-1"]);
      state.failGetNotFound = true;
      // Already-deleted (404 on get) is tolerated as success.
      yield* provider.dispose(handle);
    }),
  );

  vitIt.effect("copyInto writes the tar and extracts at destPath", () =>
    Effect.gen(function* () {
      const { sdk, state } = fakeSdk();
      const provider = makeProvider(sdk);
      const handle = yield* provider.provision({
        instanceId: "inst_1",
        config: configWithAuth(),
        image: "",
        env: [],
      });
      yield* provider.copyInto!.copyInto(
        handle,
        new Uint8Array([1, 2, 3]),
        "/home/katacode/.codex",
      );
      expect(state.runCommands.length).toBeGreaterThan(2);
      const extractRun = state.runCommands.find((r) => r.args?.join(" ")?.includes("tar -xf"));
      expect(extractRun).toBeDefined();
      expect(extractRun?.args?.join(" ")).toContain("/home/katacode/.codex");
    }),
  );

  vitIt.effect("lifecycle.stop stops the VM and status reports stopped (AC-L3/L6)", () =>
    Effect.gen(function* () {
      const { sdk, state } = fakeSdk();
      const provider = makeProvider(sdk);
      const handle = yield* provider.provision({
        instanceId: "inst_1",
        config: configWithAuth(),
        image: "",
        env: [],
      });
      yield* provider.lifecycle!.stop(handle);
      expect([...state.stoppedNames]).toEqual(["kata-inst-1"]);
      const status = yield* provider.lifecycle!.status(handle);
      expect(status).toBe("stopped");
    }),
  );

  vitIt.effect(
    "lifecycle.start resumes via get(resume:true), relaunches serve, and re-applies persistence (AC-L3)",
    () =>
      Effect.gen(function* () {
        const { sdk, state } = fakeSdk();
        const provider = makeProvider(sdk);
        const handle = yield* provider.provision({
          instanceId: "inst_1",
          config: configWithAuth(),
          image: "",
          env: [["KATACODE_DESKTOP_BOOTSTRAP_TOKEN", "bt2"]],
        });
        yield* provider.lifecycle!.stop(handle);
        const started = yield* provider.lifecycle!.start(handle, {
          config: configWithAuth(),
          env: [["KATACODE_DESKTOP_BOOTSTRAP_TOKEN", "bt2"]],
        });
        // start resumes via get(resume: true).
        const resumeGet = state.getCalls.find((c) => c.resume === true);
        expect(resumeGet).toBeDefined();
        // serve is relaunched detached.
        const serveRun = [...state.runCommands].toReversed().find((r) => r.detached === true);
        expect(serveRun?.args?.join(" ")).toContain("katacode serve");
        expect((started.handle as { sandboxId: string }).sandboxId).toBe("kata-inst-1");
        // persistence unchanged -> no update call.
        expect(state.updateCalls).toHaveLength(0);
      }),
  );

  vitIt.effect(
    "lifecycle.start fails loud for a non-persistent stopped sandbox (no silent recreate)",
    () =>
      Effect.gen(function* () {
        const { sdk } = fakeSdk();
        const provider = makeProvider(sdk);
        const handle = yield* provider.provision({
          instanceId: "inst_1",
          config: configWithAuth({ persistent: false }),
          image: "",
          env: [],
        });
        yield* provider.lifecycle!.stop(handle);
        const result = yield* either(
          provider.lifecycle!.start(handle, {
            config: configWithAuth({ persistent: false }),
            env: [],
          }),
        );
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") expect(result.left.reason).toBe("provision-failed");
      }),
  );

  vitIt.effect("lifecycle.start re-applies a persistence toggle via sandbox.update (AC-L4)", () =>
    Effect.gen(function* () {
      const { sdk, state } = fakeSdk();
      const provider = makeProvider(sdk);
      const handle = yield* provider.provision({
        instanceId: "inst_1",
        config: configWithAuth({ persistent: true }),
        image: "",
        env: [],
      });
      yield* provider.lifecycle!.stop(handle);
      // Toggle persistent off for the next start.
      yield* provider.lifecycle!.start(handle, {
        config: configWithAuth({ persistent: false }),
        env: [],
      });
      expect(state.updateCalls).toEqual([{ sandboxId: "kata-inst-1", persistent: false }]);
    }),
  );

  vitIt.effect(
    "lifecycle.status maps SDK statuses to running/stopped and gone on not-found (AC-L6)",
    () =>
      Effect.gen(function* () {
        const { sdk, state } = fakeSdk();
        const provider = makeProvider(sdk);
        const handle = yield* provider.provision({
          instanceId: "inst_1",
          config: configWithAuth(),
          image: "",
          env: [],
        });
        expect(yield* provider.lifecycle!.status(handle)).toBe("running");
        state.statusByName.set("kata-inst-1", "stopped");
        expect(yield* provider.lifecycle!.status(handle)).toBe("stopped");
        state.statusByName.set("kata-inst-1", "snapshotting");
        expect(yield* provider.lifecycle!.status(handle)).toBe("stopped");
        state.failGetNotFound = true;
        // not-found maps to the `gone` status value (not an error) so reconcile
        // evicts the record (AC-L6).
        expect(yield* provider.lifecycle!.status(handle)).toBe("gone");
      }),
  );

  vitIt.effect("describe advertises public/snapshot/renewTimeout/copyInto/resume (AC-3b.1)", () =>
    Effect.gen(function* () {
      const { sdk } = fakeSdk();
      const provider = makeProvider(sdk);
      const d = yield* provider.describe();
      expect(d.kind as string).toBe("vercel");
      expect(d.reachabilityKind).toBe("public");
      expect(d.supportsSnapshot).toBe(false);
      expect(d.supportsRenewTimeout).toBe(true);
      expect(d.supportsCopyInto).toBe(true);
      expect(d.supportsLifecycle).toBe(true);
      expect(d.maxLifetimeMs).toBe(86_400_000);
    }),
  );
});
