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
    failGetNotFound: false,
  };

  const makeInstance = (sandboxId: string): VercelSandboxInstance => ({
    sandboxId,
    domain: () => domain,
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
    stop: async () => undefined,
    delete: async () => {
      state.deleted = [...state.deleted, sandboxId];
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
    sourceType: "runtime" | "snapshot";
    snapshotId: string;
  }> = {},
) => ({
  ...DEFAULT_VERCEL_CONFIG,
  auth: AUTH,
  ...(overrides.sourceType !== undefined ? { sourceType: overrides.sourceType } : {}),
  ...(overrides.snapshotId !== undefined ? { snapshotId: overrides.snapshotId } : {}),
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
    expect(provider.snapshot).toBeDefined();
    expect(provider.renewTimeout).toBeDefined();
    expect(provider.copyInto).toBeDefined();
    expect(provider.lifecycle).toBeUndefined();
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

  vitIt.effect("validate fails invalid-config when the configured snapshot is missing", () =>
    Effect.gen(function* () {
      const { sdk } = fakeSdk();
      const provider = makeProvider(sdk);
      const result = yield* either(
        provider.validate(configWithAuth({ sourceType: "snapshot", snapshotId: "snap_gone" })),
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") expect(result.left.reason).toBe("invalid-config");
    }),
  );

  vitIt.effect("validate fails invalid-config when the snapshot status is not created", () =>
    Effect.gen(function* () {
      const { sdk, state } = fakeSdk({ snapshotStatus: "failed" });
      state.snapshots.set("snap_1", { status: "failed" });
      const provider = makeProvider(sdk);
      const result = yield* either(
        provider.validate(configWithAuth({ sourceType: "snapshot", snapshotId: "snap_1" })),
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") expect(result.left.reason).toBe("invalid-config");
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
      const hstate = handle.handle as { sandboxId: string; port: number; domainBase: string };
      expect(hstate.sandboxId).toBe("sandbox-1");
      expect(hstate.port).toBe(13773);
      expect(hstate.domainBase).toMatch(/^https:\/\//);
    }),
  );

  vitIt.effect("provision creates from snapshot source and skips the bootstrap script", () =>
    Effect.gen(function* () {
      const { sdk, state } = fakeSdk();
      state.snapshots.set("snap_base", { status: "created" });
      const provider = makeProvider(sdk);
      yield* provider.provision({
        instanceId: "inst_1",
        config: configWithAuth({ sourceType: "snapshot", snapshotId: "snap_base" }),
        image: "",
        env: [],
      });
      const createCall = state.createCalls[0] as { source?: unknown; runtime?: string };
      expect(createCall.source).toEqual({ type: "snapshot", snapshotId: "snap_base" });
      expect(createCall.runtime).toBeUndefined();
      const bootstrapRun = state.runCommands.find((r) =>
        r.args?.join(" ")?.includes("npm install -g"),
      );
      expect(bootstrapRun).toBeUndefined();
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
      expect(state.extendTimeouts).toEqual([{ sandboxId: "sandbox-1", deltaMs: 60_000 }]);
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
      expect(state.deleted).toEqual(["sandbox-1"]);
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

  vitIt.effect("createSnapshot returns the snapshot id", () =>
    Effect.gen(function* () {
      const { sdk } = fakeSdk();
      const provider = makeProvider(sdk);
      const handle = yield* provider.provision({
        instanceId: "inst_1",
        config: configWithAuth(),
        image: "",
        env: [],
      });
      const result = yield* provider.snapshot!.createSnapshot(handle);
      expect(result.snapshotId).toMatch(/^snap_/);
    }),
  );

  vitIt.effect("resume is removed from the SPI (replaced by lifecycle.start in Phase 3)", () =>
    Effect.gen(function* () {
      const { sdk, state } = fakeSdk();
      const provider = makeProvider(sdk);
      const handle = yield* provider.provision({
        instanceId: "inst_1",
        config: configWithAuth(),
        image: "",
        env: [["KATACODE_DESKTOP_BOOTSTRAP_TOKEN", "bt2"]],
      });
      // lifecycle is not present until Phase 3 wires it.
      expect(provider.lifecycle).toBeUndefined();
      // No resume get call is made.
      expect(state.getCalls.find((c) => c.resume === true)).toBeUndefined();
      expect((handle.handle as { sandboxId: string }).sandboxId).toBe("sandbox-1");
    }),
  );

  vitIt.effect("describe advertises public/snapshot/renewTimeout/copyInto/resume (AC-3b.1)", () =>
    Effect.gen(function* () {
      const { sdk } = fakeSdk();
      const provider = makeProvider(sdk);
      const d = yield* provider.describe();
      expect(d.kind as string).toBe("vercel");
      expect(d.reachabilityKind).toBe("public");
      expect(d.supportsSnapshot).toBe(true);
      expect(d.supportsRenewTimeout).toBe(true);
      expect(d.supportsCopyInto).toBe(true);
      expect(d.supportsLifecycle).toBe(false);
      expect(d.maxLifetimeMs).toBe(86_400_000);
    }),
  );
});
