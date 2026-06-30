// @effect-diagnostics globalDateInEffect:off - unique container names in the integration harness; no Effect Clock in tests.
// @effect-diagnostics globalErrorInEffectFailure:off - test-only untagged Error failures for the integration harness.
// @effect-diagnostics preferSchemaOverJson:off - ad-hoc Docker Engine JSON bodies in the integration harness, not typed codecs.
// @effect-diagnostics nodeBuiltinImport:off - temp-repo fixtures for Docker-guarded integration tests.
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { it as vitIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect } from "vite-plus/test";

import {
  DOCKER_KIND,
  DockerSandboxProvider,
  type DockerSandboxHandleState,
} from "@kata-sh/code-sandbox-docker";
import { dockerRequest, resolveDockerSocket } from "@kata-sh/code-sandbox-docker";
import type { SandboxHandle } from "@kata-sh/code-sandbox/driver";

import { runSandboxSetup } from "./sandboxSetupRunner.ts";

const INTEGRATION_IMAGE = "alpine:3.20";
const parseJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);

/** Fail loud if the Docker daemon is unreachable (no silent skip). */
function assertDockerDaemonReachable(): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const res = yield* dockerRequest("/_ping", { timeoutMs: 3_000 }).pipe(
      Effect.mapError(
        (err) =>
          new Error(
            `Docker daemon unreachable at ${resolveDockerSocket()}: ${err.message}. Start Docker/OrbStack before running the Phase 2 integration tests.`,
          ),
      ),
    );
    if (res.status !== 200) {
      return yield* Effect.fail(
        new Error(
          `Docker daemon _ping returned ${res.status}. Start Docker/OrbStack before running the Phase 2 integration tests.`,
        ),
      );
    }
  });
}

/**
 * Start a long-lived `alpine` container via the raw Engine API and return a
 * `SandboxHandle` for it. The caller MUST remove the container via
 * `removeContainer`.
 */
function startAlpineContainer(label: string): Effect.Effect<SandboxHandle, Error> {
  return Effect.gen(function* () {
    yield* assertDockerDaemonReachable();
    const name = `kata-setup-test-${label}-${Date.now()}`;
    const create = yield* dockerRequest("/containers/create", {
      method: "POST",
      body: JSON.stringify({
        Image: INTEGRATION_IMAGE,
        Cmd: ["sh", "-c", "sleep 300"],
        Labels: { "kata.sandbox.test": "true" },
      }),
    }).pipe(Effect.mapError((err) => new Error(`container create failed: ${err.message}`)));
    if (create.status >= 300) {
      return yield* Effect.fail(
        new Error(`container create failed: ${create.status} ${create.body.slice(0, 200)}`),
      );
    }
    const containerId = (parseJson(create.body) as { Id: string }).Id;
    const start = yield* dockerRequest(`/containers/${containerId}/start`, {
      method: "POST",
    }).pipe(Effect.mapError((err) => new Error(`container start failed: ${err.message}`)));
    if (start.status >= 300) {
      yield* dockerRequest(`/containers/${containerId}?force=true`, { method: "DELETE" }).pipe(
        Effect.ignore,
      );
      return yield* Effect.fail(new Error(`container start failed: ${start.status}`));
    }
    const state: DockerSandboxHandleState = {
      containerId,
      hostPort: 0,
      containerPort: 13773,
    };
    return {
      driverKind: DOCKER_KIND,
      instanceId: name,
      handle: state,
    } satisfies SandboxHandle;
  });
}

/** Force-remove a container (best-effort, never fails the test). */
function removeContainer(handle: SandboxHandle): Effect.Effect<void, never> {
  const state = handle.handle as DockerSandboxHandleState;
  return dockerRequest(`/containers/${state.containerId}?force=true`, {
    method: "DELETE",
  }).pipe(Effect.ignore, Effect.asVoid);
}

/** Create a temp repo dir. Returns the dir path; pair with `rmTempRepo`. */
async function makeTempRepo(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `kata-setup-${name}-`));
}

/** Always-removing wrapper for a temp repo dir. */
function withTempRepo(
  name: string,
  body: (dir: string) => Effect.Effect<void, Error>,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const dir = yield* Effect.promise(() => makeTempRepo(name));
    yield* body(dir).pipe(
      Effect.ensuring(
        Effect.promise(() => fs.rm(dir, { recursive: true, force: true }).catch(() => {})),
      ),
    );
  });
}

/** Write a file in a temp repo (Effect-wrapped). */
function writeRepoFile(dir: string, rel: string, content: string): Effect.Effect<void, Error> {
  return Effect.promise(() => fs.writeFile(path.join(dir, rel), content));
}

describe("runSandboxSetup Docker integration (Docker-guarded, AC-2.2/2.3/2.4)", () => {
  vitIt.effect(
    "seeds a repo into /workspace and runs a blocking install against the seeded files (AC-2.2)",
    () =>
      Effect.gen(function* () {
        const handle = yield* startAlpineContainer("seed-install");
        yield* withTempRepo("seed", (repoRoot) =>
          Effect.gen(function* () {
            yield* writeRepoFile(repoRoot, "greeting.txt", "hello-from-seed");
            // install reads the seeded file so it proves the seed landed in /workspace.
            const result = yield* runSandboxSetup({
              driver: DockerSandboxProvider,
              handle,
              resolved: {
                install: "cat /workspace/greeting.txt",
                provenance: {},
              },
              secretValues: [],
              seed: { repoRoot },
            });
            expect(result.installOutput.exitCode).toBe(0);
            expect(result.installOutput.stdout.trim()).toBe("hello-from-seed");
          }),
        ).pipe(Effect.ensuring(removeContainer(handle)));
      }),
  );

  vitIt.effect("a non-zero install exit surfaces as SetupFailed (not swallowed) (AC-2.2)", () =>
    Effect.gen(function* () {
      const handle = yield* startAlpineContainer("install-fail");
      yield* withTempRepo("fail", (repoRoot) =>
        Effect.gen(function* () {
          yield* writeRepoFile(repoRoot, "keep.txt", "x");
          const caught = yield* runSandboxSetup({
            driver: DockerSandboxProvider,
            handle,
            resolved: { install: "exit 7", provenance: {} },
            secretValues: [],
            seed: { repoRoot },
          }).pipe(
            Effect.catchTag("SetupFailed", (e) => Effect.succeed({ ok: false as const, error: e })),
            Effect.map(
              (r) => r as { ok: true } | { ok: false; error: { stage: string; exitCode?: number } },
            ),
          );
          expect(caught.ok).toBe(false);
          if (caught.ok) return;
          expect(caught.error.stage).toBe("install");
          expect(caught.error.exitCode).toBe(7);
        }),
      ).pipe(Effect.ensuring(removeContainer(handle)));
    }),
  );

  vitIt.effect("redacts every injected secret value from install output (AC-2.4)", () =>
    Effect.gen(function* () {
      const handle = yield* startAlpineContainer("redact");
      yield* withTempRepo("redact", (repoRoot) =>
        Effect.gen(function* () {
          yield* writeRepoFile(repoRoot, "keep.txt", "x");
          const secret = "AKIA-DOCKER-SECRET-VALUE";
          // install echoes the secret value (simulating a user script that
          // leaks an env var); the runner must redact it before surfacing.
          const result = yield* runSandboxSetup({
            driver: DockerSandboxProvider,
            handle,
            resolved: { install: `printf '%s' '${secret}'`, provenance: {} },
            secretValues: [secret],
            seed: { repoRoot },
          });
          expect(result.installOutput.stdout).toBe("***");
          expect(result.installOutput.stdout).not.toContain(secret);
        }),
      ).pipe(Effect.ensuring(removeContainer(handle)));
    }),
  );

  vitIt.live("detached start/terminals survive the exec return and appear in ps (AC-2.3)", () =>
    Effect.gen(function* () {
      const handle = yield* startAlpineContainer("detached");
      yield* withTempRepo("detached", (repoRoot) =>
        Effect.gen(function* () {
          yield* writeRepoFile(repoRoot, "keep.txt", "x");
          const result = yield* runSandboxSetup({
            driver: DockerSandboxProvider,
            handle,
            resolved: {
              // Distinct from the harness container's `sleep 300`; short enough
              // to finish quickly if backgrounding fails (test timeout is 120s).
              start: "sleep 8",
              terminals: [{ name: "web", command: "sleep 9" }],
              provenance: {},
            },
            secretValues: [],
          });
          expect(result.processes).toEqual([
            { name: "start", command: "sleep 8" },
            { name: "web", command: "sleep 9" },
          ]);
          // Brief real-time pause so the detached processes are visible in ps.
          yield* Effect.sleep("500 millis");
          const ps = yield* DockerSandboxProvider.exec(handle, "ps -eo pid,ppid,sid,args");
          expect(ps.exitCode).toBe(0);
          // Both detached sleeps must be present (proves survival + visibility).
          expect(ps.stdout).toContain("sleep 8");
          expect(ps.stdout).toContain("sleep 9");
        }),
      ).pipe(Effect.ensuring(removeContainer(handle)));
    }),
  );

  vitIt.effect(
    "reports an empty process set and starts no detached process when start/terminals are unset (AC-2.3)",
    () =>
      Effect.gen(function* () {
        const handle = yield* startAlpineContainer("empty");
        yield* withTempRepo("empty", (repoRoot) =>
          Effect.gen(function* () {
            yield* writeRepoFile(repoRoot, "keep.txt", "x");
            const result = yield* runSandboxSetup({
              driver: DockerSandboxProvider,
              handle,
              resolved: { provenance: {} },
              secretValues: [],
            });
            expect(result.processes).toEqual([]);
            const ps = yield* DockerSandboxProvider.exec(handle, "ps -eo pid,ppid,sid,args");
            expect(ps.exitCode).toBe(0);
            // The container's own `sleep 300` (from startAlpineContainer) is
            // present, but no detached sleeps from the runner.
            expect(ps.stdout).not.toContain("sleep 8");
            expect(ps.stdout).not.toContain("sleep 9");
          }),
        ).pipe(Effect.ensuring(removeContainer(handle)));
      }),
  );
});
