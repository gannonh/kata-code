/**
 * Failure-path coverage for GitHub-sourced sandbox create/start gates.
 *
 * Uses an injectable registry + stub driver so provision orchestration can be
 * exercised without Docker/Vercel SDKs.
 */
import { describe, expect } from "vite-plus/test";
import { it as vitIt } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type { ServerSettings } from "@kata-sh/code-contracts";
import { SandboxProviderInstanceId } from "@kata-sh/code-contracts/sandboxProviderInstance";
import { SandboxProviderDriverKind } from "@kata-sh/code-sandbox-contracts/instance";
import { SandboxReachabilityKind } from "@kata-sh/code-sandbox-contracts/reachability";
import type { SandboxHandle, SandboxProvider } from "@kata-sh/code-sandbox/driver";
import { SandboxProviderRegistry } from "@kata-sh/code-sandbox/registry";

import * as CloudCliTokenManager from "../cloud/CliTokenManager.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { startSandboxSession, type SandboxStartSessionRuntime } from "./sandboxStartSession.ts";
import type { SandboxSessionStore } from "./sandboxSessionStore.ts";

const stubCloudCliTokenManager = Layer.mock(CloudCliTokenManager.CloudCliTokenManager)({
  get: Effect.die(new Error("Unexpected Kata Code Connect CLI authorization request.")),
  getExisting: Effect.succeed(Option.none()),
  hasCredential: Effect.succeed(false),
  clear: Effect.void,
});

const stubServerSecretStore = Layer.mock(ServerSecretStore.ServerSecretStore)({
  get: () => Effect.succeed(null),
  set: () => Effect.void,
  create: () => Effect.void,
  getOrCreateRandom: () => Effect.die(new Error("Unexpected secret generation request.")),
  remove: () => Effect.void,
});

const startSessionTestLayer = Layer.mergeAll(
  stubCloudCliTokenManager,
  stubServerSecretStore,
  NodeServices.layer,
);

const KIND = SandboxProviderDriverKind.make("stub-sourced");
const INSTANCE_ID = SandboxProviderInstanceId.make("stub-sourced_test");

const handle: SandboxHandle = {
  driverKind: KIND,
  instanceId: INSTANCE_ID as string,
  handle: { id: "h1" },
};

function makeSourcedDriver(options?: { readonly execExitCode?: number }): SandboxProvider {
  const execExitCode = options?.execExitCode ?? 0;
  return {
    kind: KIND,
    validate: () => Effect.void,
    provision: () => Effect.succeed(handle),
    exec: () =>
      Effect.succeed({
        exitCode: execExitCode,
        stdout: "",
        stderr: execExitCode === 0 ? "" : "missing tools",
      }),
    reachability: () =>
      Effect.succeed({
        reachabilityKind: SandboxReachabilityKind.make("loopback"),
        httpBaseUrl: "http://localhost:1",
        wsBaseUrl: "ws://localhost:1",
      }),
    dispose: () => Effect.void,
    describe: () =>
      Effect.succeed({
        kind: KIND,
        reachabilityKind: SandboxReachabilityKind.make("loopback"),
        supportsSnapshot: false,
        supportsRenewTimeout: false,
        supportsCopyInto: true,
        supportsLifecycle: true,
        supportsProjectSource: true,
      }),
    projectSource: {
      workspacePath: "/workspace",
      authSeedCwd: "/",
      strategy: "exec-clone",
      supportsDockerfileBuild: true,
    },
    copyInto: { copyInto: () => Effect.void },
    lifecycle: {
      stop: () => Effect.void,
      start: (h) => Effect.succeed(h),
      status: () => Effect.succeed("stopped" as const),
    },
  };
}

function makeRuntime(
  driver: SandboxProvider,
  storeRecords: SandboxSessionStore["records"] = [],
): SandboxStartSessionRuntime {
  const registry = new SandboxProviderRegistry();
  registry.register(driver, (input) => input);
  const records = [...storeRecords];
  return {
    busyInstances: new Set(),
    getStore: () =>
      ({
        records,
        load: () => Effect.succeed(records),
        upsert: () => Effect.void,
        remove: () => Effect.void,
        replaceAll: () => Effect.void,
      }) as unknown as SandboxSessionStore,
    liveSessions: new Map(),
    nameNamespace: undefined,
    registry,
    refreshLockedInstanceStatus: () => Effect.void,
    registerAndFinalizeSession: () =>
      Effect.succeed({
        environmentId: "env_test",
        pairingToken: "pair",
        endpoint: {
          id: "ep",
          label: "test",
          kind: "manual",
          httpBaseUrl: "http://localhost:1",
          wsBaseUrl: "ws://localhost:1",
        },
        relay: null,
        adminAccessToken: "admin",
      }) as never,
    disposeAfterFailure: () => Effect.void,
    persistSessionRecord: () => Effect.void,
  };
}

function settingsWithConfig(config: unknown): ServerSettings {
  return {
    sandboxProviderInstances: {
      [INSTANCE_ID as string]: {
        driver: KIND,
        config,
      },
    },
    savedSandboxEnvironments: {},
  } as ServerSettings;
}

function runStart(
  runtime: SandboxStartSessionRuntime,
  settings: ServerSettings,
  options?: Parameters<typeof startSandboxSession>[3],
) {
  return startSandboxSession(runtime, INSTANCE_ID, settings, options).pipe(
    Effect.provide(startSessionTestLayer),
  );
}

describe("startSandboxSession GitHub source failure paths", () => {
  vitIt.effect("rejects create when projectSource is advertised but source is incomplete", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime(makeSourcedDriver());
      const exit = yield* Effect.exit(
        runStart(runtime, settingsWithConfig({}), {
          resolveGitHubToken: Effect.succeed("gho_test"),
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) return;
      expect(String(exit.cause)).toMatch(/Select a GitHub repository and branch/);
    }),
  );

  vitIt.effect("rejects a local repository option for projectSource drivers", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime(makeSourcedDriver());
      const exit = yield* Effect.exit(
        runStart(
          runtime,
          settingsWithConfig({ source: { repository: "octocat/Hello-World", branch: "main" } }),
          {
            repository: {
              repoRoot: "/tmp/repo",
              repositoryIdentity: { canonicalKey: "github.com/octocat/hello-world" },
            } as never,
            resolveGitHubToken: Effect.succeed("gho_test"),
          },
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) return;
      expect(String(exit.cause)).toMatch(/local repository cannot be provided/);
    }),
  );

  vitIt.effect("fails loud when exec-clone image lacks git/gh", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime(makeSourcedDriver({ execExitCode: 127 }));
      const exit = yield* Effect.exit(
        runStart(
          runtime,
          settingsWithConfig({ source: { repository: "octocat/Hello-World", branch: "main" } }),
          { resolveGitHubToken: Effect.succeed("gho_test") },
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) return;
      expect(String(exit.cause)).toMatch(/missing `git` and\/or `gh`/);
    }),
  );

  vitIt.effect("rejects lifecycle start when the configured source fingerprint changed", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime(makeSourcedDriver(), [
        {
          instanceId: INSTANCE_ID as string,
          status: "stopped",
          handle: { driverKind: KIND, instanceId: INSTANCE_ID as string, handle: { id: "h1" } },
          sourceFingerprint: "old-fingerprint",
          environmentId: "env_old",
          endpoint: {
            id: "ep",
            label: "test",
            kind: "manual",
            httpBaseUrl: "http://localhost:1",
            wsBaseUrl: "ws://localhost:1",
          },
          driver: KIND as string,
          config: {},
          relay: null,
        } as never,
      ]);
      const exit = yield* Effect.exit(
        runStart(
          runtime,
          settingsWithConfig({ source: { repository: "octocat/Hello-World", branch: "main" } }),
          { resolveGitHubToken: Effect.succeed("gho_test") },
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) return;
      expect(String(exit.cause)).toMatch(/source changed since it was created/);
    }),
  );
});
