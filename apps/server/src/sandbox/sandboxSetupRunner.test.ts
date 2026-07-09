import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { it as vitIt } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";

import type {
  SandboxExecResult,
  SandboxHandle,
  SandboxProvider,
} from "@kata-sh/code-sandbox/driver";
import type { ResolvedEnvironmentConfig } from "@kata-sh/code-sandbox";

import { runSandboxSetup, type SetupProcessRecord } from "./sandboxSetupRunner.ts";

/** A test-only driver whose `exec` results are configurable per command. */
function createRecordingDriver(overrides: {
  readonly execResults?: ReadonlyMap<string, SandboxExecResult>;
  readonly copyInto?: (
    handle: SandboxHandle,
    archive: Uint8Array,
    destPath: string,
  ) => Effect.Effect<void, never>;
  readonly hasCopyInto?: boolean;
}): SandboxProvider {
  const recordedExecs: Array<{ readonly command: string; readonly cwd?: string }> = [];
  const driver: SandboxProvider = {
    // The runner only calls exec/copyInto; the other members are stubs.
    kind: "stub" as never,
    validate: () => Effect.void,
    provision: () =>
      Effect.succeed({ driverKind: "stub" as never, instanceId: "x", handle: { stub: true } }),
    exec: (_handle, command, opts) => {
      recordedExecs.push({ command, ...(opts?.cwd !== undefined ? { cwd: opts.cwd } : {}) });
      const result = overrides.execResults?.get(command);
      if (result) return Effect.succeed(result);
      return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
    },
    reachability: () =>
      Effect.succeed({
        reachabilityKind: "loopback" as never,
        httpBaseUrl: "http://localhost:1",
        wsBaseUrl: "ws://localhost:1",
      }),
    dispose: () => Effect.void,
    describe: () =>
      Effect.succeed({
        kind: "stub" as never,
        reachabilityKind: "loopback" as never,
        supportsSnapshot: false,
        supportsRenewTimeout: false,
        supportsCopyInto: overrides.hasCopyInto !== false,
        supportsLifecycle: false,
      }),
    ...(overrides.copyInto ? { copyInto: { copyInto: overrides.copyInto } } : {}),
  };
  return Object.assign(driver, { recordedExecs });
}

const handle: SandboxHandle = {
  driverKind: "stub" as never,
  instanceId: "x",
  handle: { stub: true },
};

const resolved = (overrides: Partial<ResolvedEnvironmentConfig>): ResolvedEnvironmentConfig =>
  ({
    provenance: {},
    ...overrides,
  }) as ResolvedEnvironmentConfig;

describe("runSandboxSetup (install path, AC-2.2/2.4)", () => {
  vitIt.effect("runs install blocking in /workspace and returns its output", () =>
    Effect.gen(function* () {
      const driver = createRecordingDriver({
        execResults: new Map([["pnpm i", { exitCode: 0, stdout: "installed", stderr: "" }]]),
      });
      const result = yield* runSandboxSetup({
        driver,
        handle,
        resolved: resolved({ install: "pnpm i" }),
        secretValues: [],
      });
      expect(result.installOutput.exitCode).toBe(0);
      expect(result.installOutput.stdout).toBe("installed");
      // install ran with cwd /workspace.
      const recorded = (driver as unknown as { recordedExecs: Array<{ cwd?: string }> })
        .recordedExecs;
      expect(recorded[0]?.cwd).toBe("/workspace");
    }),
  );

  vitIt.effect("redacts every injected secret value from install output", () =>
    Effect.gen(function* () {
      const secret = "AKIA-SECRET-VALUE";
      const driver = createRecordingDriver({
        execResults: new Map([["printenv MY_SECRET", { exitCode: 0, stdout: secret, stderr: "" }]]),
      });
      const result = yield* runSandboxSetup({
        driver,
        handle,
        resolved: resolved({ install: "printenv MY_SECRET" }),
        secretValues: [secret],
      });
      expect(result.installOutput.stdout).toBe("***");
      expect(result.installOutput.stdout).not.toContain(secret);
    }),
  );

  vitIt.effect("fails with SetupFailed (install) on a non-zero exit, redacted", () =>
    Effect.gen(function* () {
      const secret = "leak-me";
      const driver = createRecordingDriver({
        execResults: new Map([
          ["bad-install", { exitCode: 2, stdout: `error: ${secret}`, stderr: "boom" }],
        ]),
      });
      const outcome = yield* runSandboxSetup({
        driver,
        handle,
        resolved: resolved({ install: "bad-install" }),
        secretValues: [secret],
      }).pipe(Effect.result);
      expect(Result.isFailure(outcome)).toBe(true);
      if (!Result.isFailure(outcome)) return;
      const err = outcome.failure;
      if (err._tag !== "SetupFailed") {
        expect.fail(`expected SetupFailed, got ${err._tag}`);
        return;
      }
      expect(err.stage).toBe("install");
      expect(err.exitCode).toBe(2);
      expect(err.stdout).toBe("error: ***");
      expect(err.stdout).not.toContain(secret);
    }),
  );
});

describe("runSandboxSetup (seed via copyInto, AC-2.2/2.4)", () => {
  vitIt.effect("seeds the repo into /workspace via the driver copyInto capability", () =>
    Effect.gen(function* () {
      let seeded: { destPath: string; bytes: number } | undefined;
      const driver = createRecordingDriver({
        copyInto: (_h, archive, destPath) =>
          Effect.sync(() => {
            seeded = { destPath, bytes: archive.byteLength };
          }),
      });
      yield* runSandboxSetup({
        driver,
        handle,
        resolved: resolved({ install: "true" }),
        secretValues: [],
        seed: { repoRoot: import.meta.dirname },
      });
      expect(seeded).toBeDefined();
      expect(seeded?.destPath).toBe("/workspace");
      expect(seeded?.bytes).toBeGreaterThan(0);
    }),
  );

  vitIt.effect("fails with SetupFailed (seed) when the driver lacks copyInto", () =>
    Effect.gen(function* () {
      const driver = createRecordingDriver({ hasCopyInto: false });
      const outcome = yield* runSandboxSetup({
        driver,
        handle,
        resolved: resolved({ install: "true" }),
        secretValues: [],
        seed: { repoRoot: import.meta.dirname },
      }).pipe(Effect.result);
      expect(Result.isFailure(outcome)).toBe(true);
      if (!Result.isFailure(outcome)) return;
      const err = outcome.failure;
      if (err._tag !== "SetupFailed") {
        expect.fail(`expected SetupFailed, got ${err._tag}`);
        return;
      }
      expect(err.stage).toBe("seed");
      expect(err.message).toContain("copyInto");
    }),
  );
});

describe("runSandboxSetup (detached start/terminals, AC-2.3)", () => {
  vitIt.effect("launches start detached and records the process", () =>
    Effect.gen(function* () {
      const seen: string[] = [];
      const driver = createRecordingDriver({
        execResults: new Map([
          // The detached command returns exit 0 immediately (it backgrounds).
          ["__start__", { exitCode: 0, stdout: "", stderr: "" }],
        ]),
        // Capture the actual command string the runner exec'd for start.
        copyInto: () => Effect.void,
      });
      // Override exec to record the raw command string.
      const baseExec = driver.exec;
      (driver as { exec: typeof baseExec }).exec = (_h, command) => {
        seen.push(command);
        if (command.startsWith("setsid")) {
          return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
        }
        return baseExec(_h, command, {});
      };
      const result = yield* runSandboxSetup({
        driver,
        handle,
        resolved: resolved({ start: "pnpm dev" }),
        secretValues: [],
      });
      const startCmd = seen.find((c) => c.startsWith("setsid"));
      expect(startCmd).toBeDefined();
      expect(startCmd).toContain("pnpm dev");
      expect(result.processes).toEqual([
        { name: "start", command: "pnpm dev" },
      ] satisfies ReadonlyArray<SetupProcessRecord>);
    }),
  );

  vitIt.effect("launches each terminal detached and records it", () =>
    Effect.gen(function* () {
      const seen: string[] = [];
      const driver = createRecordingDriver({});
      const baseExec = driver.exec;
      (driver as { exec: typeof baseExec }).exec = (_h, command) => {
        seen.push(command);
        return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
      };
      const result = yield* runSandboxSetup({
        driver,
        handle,
        resolved: resolved({
          terminals: [
            { name: "web", command: "serve" },
            { name: "worker", command: "node worker.js" },
          ],
        }),
        secretValues: [],
      });
      expect(result.processes).toEqual([
        { name: "web", command: "serve" },
        { name: "worker", command: "node worker.js" },
      ]);
      // Each terminal command is wrapped in a detached setsid invocation.
      const detached = seen.filter((c) => c.startsWith("setsid"));
      expect(detached).toHaveLength(2);
      expect(detached.some((c) => c.includes("serve"))).toBe(true);
      expect(detached.some((c) => c.includes("node worker.js"))).toBe(true);
    }),
  );

  vitIt.effect(
    "reports an empty process set and starts no detached process when start/terminals are unset",
    () =>
      Effect.gen(function* () {
        const seen: string[] = [];
        const driver = createRecordingDriver({});
        const baseExec = driver.exec;
        (driver as { exec: typeof baseExec }).exec = (_h, command) => {
          seen.push(command);
          return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
        };
        const result = yield* runSandboxSetup({
          driver,
          handle,
          resolved: resolved({}),
          secretValues: [],
        });
        expect(result.processes).toEqual([]);
        expect(seen.some((c) => c.startsWith("setsid"))).toBe(false);
      }),
  );
});
