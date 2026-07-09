// @effect-diagnostics globalDateInEffect:off - unique container names in the integration harness; no Effect Clock in tests.
// @effect-diagnostics preferSchemaOverJson:off - ad-hoc Docker Engine JSON bodies in the integration harness, not typed codecs.
// @effect-diagnostics globalErrorInEffectFailure:off - test-only untagged Error failures for the integration harness.
import { describe, expect, it } from "vite-plus/test";
import { it as vitIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  DockerSandboxProvider,
  makeDockerSandboxProvider,
  dockerContainerName,
  dockerConfigDecoder,
  DOCKER_KIND,
  type DockerSandboxHandleState,
} from "./DockerSandboxProvider.ts";
import { DockerSandboxConfig, DEFAULT_DOCKER_CONFIG } from "./config.ts";
import { dockerRequest, resolveDockerSocket } from "./dockerEngine.ts";
import type { SandboxHandle } from "@kata-sh/code-sandbox/driver";

const decodeConfig = Schema.decodeUnknownSync(DockerSandboxConfig);

describe("DockerSandboxProvider (non-Docker unit coverage)", () => {
  it("dockerContainerName derives a deterministic slug-safe name from an instance id", () => {
    expect(dockerContainerName("docker_docker_test_01")).toBe("kata-sandbox-docker_docker_test_01");
    // Same input -> same name (stable across restarts, no timestamp).
    expect(dockerContainerName("docker_docker_test_01")).toBe(
      dockerContainerName("docker_docker_test_01"),
    );
  });

  it("testConnection probe ids do not collide with durable container names", () => {
    const durable = "docker_docker_test_01";
    const probe = `${durable}__probe_abcd1234`;
    expect(dockerContainerName(probe)).not.toBe(dockerContainerName(durable));
  });

  it("kind is the branded 'docker' slug", () => {
    expect(DOCKER_KIND as string).toBe("docker");
  });

  it("config decodes a full payload", () => {
    const decoded = decodeConfig({
      image: "node:22-alpine",
      command: "katacode serve --port 13773",
      port: 13773,
    });
    expect(decoded.image).toBe("node:22-alpine");
    expect(decoded.port).toBe(13773);
  });

  it("dockerConfigDecoder is the registry-facing decode function", () => {
    const decoded = dockerConfigDecoder({ image: "alpine", command: "x", port: 1 });
    expect(decoded.port).toBe(1);
  });

  vitIt.effect(
    "describe() advertises loopback reachability, lifecycle, and no snapshot support",
    () =>
      Effect.gen(function* () {
        const d = yield* DockerSandboxProvider.describe();
        expect(d.kind as string).toBe("docker");
        expect(d.reachabilityKind).toBe("loopback");
        expect(d.supportsSnapshot).toBe(false);
        expect(d.supportsRenewTimeout).toBe(false);
        expect(d.supportsCopyInto).toBe(true);
        expect(d.supportsLifecycle).toBe(true);
        expect(d.baseImages?.[0]).toBe(DEFAULT_DOCKER_CONFIG.image);
      }),
  );

  vitIt.effect("lifecycle capability is present and matches describe().supportsLifecycle", () =>
    Effect.gen(function* () {
      const d = yield* DockerSandboxProvider.describe();
      expect(DockerSandboxProvider.lifecycle).toBeDefined();
      expect(DockerSandboxProvider.lifecycle !== undefined).toBe(d.supportsLifecycle);
      expect(DockerSandboxProvider.lifecycle?.stop).toBeDefined();
      expect(DockerSandboxProvider.lifecycle?.start).toBeDefined();
      expect(DockerSandboxProvider.lifecycle?.status).toBeDefined();
    }),
  );

  vitIt.effect(
    "copyInto capability is present and matches describe().supportsCopyInto (AC-2.2 seeding)",
    () =>
      Effect.gen(function* () {
        const d = yield* DockerSandboxProvider.describe();
        expect(DockerSandboxProvider.copyInto).toBeDefined();
        expect(DockerSandboxProvider.copyInto !== undefined).toBe(d.supportsCopyInto);
      }),
  );

  vitIt.effect("reachability() resolves a loopback localhost URL from a handle", () =>
    Effect.gen(function* () {
      const handle = {
        driverKind: DOCKER_KIND,
        instanceId: "x",
        handle: {
          containerId: "c",
          containerName: "kata-sandbox-x",
          hostPort: 32789,
          containerPort: 13773,
        },
      };
      const r = yield* DockerSandboxProvider.reachability(handle, 13773);
      expect(r.reachabilityKind).toBe("loopback");
      expect(r.httpBaseUrl).toBe("http://localhost:32789");
      expect(r.wsBaseUrl).toBe("ws://localhost:32789");
    }),
  );
});

// ── Docker-guarded integration coverage (AC-2.2/2.3/2.4 cwd + demux + seeding) ──
// These tests provision a real container and fail loud if the Docker daemon is
// absent (no silent skip). They cover the Phase 2 driver fixes: exec honors
// opts.cwd, exec demultiplexes the raw Engine stream into clean stdout/stderr,
// and copyInto uploads a tar archive that is then readable in-container.

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
 * `SandboxHandle` for it. The container is NOT provisioned through the driver's
 * `provision` (which waits for HTTP readiness on the katacode image); these
 * tests target `exec`/`copyInto` behavior, which only need a running
 * container id. The caller MUST remove the container via `removeContainer`.
 */
function startAlpineContainer(label: string): Effect.Effect<SandboxHandle, Error> {
  return Effect.gen(function* () {
    yield* assertDockerDaemonReachable();
    const name = `kata-sandbox-test-${label}-${Date.now()}`;
    const create = yield* dockerRequest(`/containers/create?name=${name}`, {
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
      containerName: name,
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

/**
 * Build a minimal POSIX tar archive containing a single UTF-8 file at
 * `fileName` with `content`. Tar entries are 512-byte headers followed by
 * the file content padded to a 512-byte boundary, ending with two 512-byte
 * zero blocks. No external tar dependency needed for a one-file archive.
 */
function buildSingleFileTar(fileName: string, content: string): Uint8Array {
  const name = Buffer.from(fileName, "utf8");
  const data = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512, 0);
  name.copy(header, 0, 0, Math.min(name.length, 100));
  // mode (octal, null-terminated): 0000644
  header.write("0000644\0", 100, "ascii");
  // uid/gid: 0000000
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  // size (octal, null-terminated, 11 digits + null)
  const sizeOct = data.length.toString(8).padStart(11, "0");
  header.write(`${sizeOct}\0`, 124, "ascii");
  // mtime: 00000000000
  header.write("00000000000\0", 136, "ascii");
  // checksum placeholder (8 spaces) — computed below
  header.write("        ", 148, "ascii");
  // typeflag: '0' (regular file)
  header.write("0", 156, "ascii");
  // magic: "ustar\0"
  header.write("ustar\0", 257, "ascii");
  // compute checksum: sum of all header bytes with checksum field as spaces
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i] ?? 0;
  header.write(checksum.toString(8).padStart(6, "0"), 148, "ascii");
  header.write("\0 ", 154, "ascii");
  // content padded to 512-byte boundary
  const padding = (512 - (data.length % 512)) % 512;
  const contentBlock = Buffer.concat([data, Buffer.alloc(padding, 0)]);
  // two zero blocks terminator
  const terminator = Buffer.alloc(1024, 0);
  return Buffer.concat([header, contentBlock, terminator]);
}

describe("DockerSandboxProvider exec/copyInto integration (Docker-guarded, AC-2.2/2.3/2.4)", () => {
  vitIt.effect("exec honors opts.cwd (WorkingDir) so commands run in /workspace", () =>
    Effect.gen(function* () {
      const handle = yield* startAlpineContainer("cwd");
      yield* Effect.gen(function* () {
        // Ensure /workspace exists, then pwd into it via cwd.
        const mkdir = yield* DockerSandboxProvider.exec(handle, "mkdir -p /workspace");
        expect(mkdir.exitCode).toBe(0);
        const pwd = yield* DockerSandboxProvider.exec(handle, "pwd", { cwd: "/workspace" });
        expect(pwd.exitCode).toBe(0);
        expect(pwd.stdout.trim()).toBe("/workspace");
      }).pipe(Effect.ensuring(removeContainer(handle)));
    }),
  );

  vitIt.effect("exec demultiplexes stdout and stderr with no frame-header bytes", () =>
    Effect.gen(function* () {
      const handle = yield* startAlpineContainer("demux");
      yield* Effect.gen(function* () {
        // Write to stdout and stderr; the raw Engine stream frames each on a
        // different stream type. After demux, stdout/stderr must be populated
        // and stdout must not contain the 8-byte frame header bytes.
        const out = yield* DockerSandboxProvider.exec(
          handle,
          "printf 'out-line\\n' 1>&2; printf 'STDOUT-MARKER\\n'",
        );
        expect(out.exitCode).toBe(0);
        expect(out.stdout).toContain("STDOUT-MARKER");
        expect(out.stderr.trim()).toBe("out-line");
        // The demultiplexer must strip frame headers: a raw stream would start
        // with a frame header byte (0x01 or 0x02) — assert it does not.
        expect(out.stdout.charCodeAt(0)).not.toBe(1);
        expect(out.stdout.charCodeAt(0)).not.toBe(2);
        expect(out.stderr.charCodeAt(0)).not.toBe(1);
        expect(out.stderr.charCodeAt(0)).not.toBe(2);
      }).pipe(Effect.ensuring(removeContainer(handle)));
    }),
  );

  vitIt.live("exec returns promptly for a setsid-detached background command (AC-2.3 spike)", () =>
    Effect.gen(function* () {
      const handle = yield* startAlpineContainer("detached");
      yield* Effect.gen(function* () {
        const started = Date.now();
        const detached = yield* DockerSandboxProvider.exec(
          handle,
          "setsid sh -c 'sleep 8 > /tmp/kata-detached-spike.log 2>&1 &'",
        );
        const elapsed = Date.now() - started;
        expect(detached.exitCode).toBe(0);
        // The spike proved the outer exec must not block on the backgrounded child.
        expect(elapsed).toBeLessThan(5_000);
        // Brief real-time pause so the detached child is visible in ps.
        yield* Effect.sleep("300 millis");
        const ps = yield* DockerSandboxProvider.exec(handle, "ps -eo pid,ppid,sid,args");
        expect(ps.stdout).toContain("sleep 8");
      }).pipe(Effect.ensuring(removeContainer(handle)));
    }),
  );

  vitIt.effect("copyInto uploads a tar that is then readable in-container (AC-2.2 seeding)", () =>
    Effect.gen(function* () {
      const handle = yield* startAlpineContainer("copyinto");
      yield* Effect.gen(function* () {
        const archive = buildSingleFileTar("seeded.txt", "hello-from-host");
        // copyInto is a capability object on the provider; the runner task will
        // guard with describe().supportsCopyInto, but here the Docker driver
        // advertises it, so call it directly.
        if (!DockerSandboxProvider.copyInto) {
          return yield* Effect.fail(new Error("copyInto capability absent on Docker driver"));
        }
        yield* DockerSandboxProvider.copyInto.copyInto(handle, archive, "/workspace");
        const cat = yield* DockerSandboxProvider.exec(handle, "cat /workspace/seeded.txt", {
          cwd: "/workspace",
        });
        expect(cat.exitCode).toBe(0);
        expect(cat.stdout).toBe("hello-from-host");
      }).pipe(Effect.ensuring(removeContainer(handle)));
    }),
  );
});

/** A Docker provider with a healthz probe that always succeeds, so lifecycle
 *  start/stop/status integration tests work against a plain `alpine` container
 *  that does not serve HTTP (AC-L5/L6). */
const providerWithFakeProbe = makeDockerSandboxProvider({
  healthzProbe: () => Effect.succeed(true),
});

/** Start an alpine container with a published port (no listener) so lifecycle
 *  start can read a host port binding from inspect. The caller MUST remove it. */
function startAlpineContainerWithPort(label: string): Effect.Effect<SandboxHandle, Error> {
  return Effect.gen(function* () {
    yield* assertDockerDaemonReachable();
    const name = `kata-sandbox-test-${label}-${Date.now()}`;
    const create = yield* dockerRequest(`/containers/create?name=${name}`, {
      method: "POST",
      body: JSON.stringify({
        Image: INTEGRATION_IMAGE,
        Cmd: ["sh", "-c", "sleep 300"],
        ExposedPorts: { "8080/tcp": {} },
        HostConfig: { PortBindings: { "8080/tcp": [{ HostPort: "0" }] } },
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
    if (start.status >= 300 && start.status !== 304) {
      yield* dockerRequest(`/containers/${containerId}?force=true`, { method: "DELETE" }).pipe(
        Effect.ignore,
      );
      return yield* Effect.fail(new Error(`container start failed: ${start.status}`));
    }
    const inspect = yield* dockerRequest(`/containers/${containerId}/json`).pipe(
      Effect.mapError((err) => new Error(`container inspect failed: ${err.message}`)),
    );
    const info = parseJson(inspect.body) as {
      NetworkSettings: {
        Ports: Record<string, ReadonlyArray<{ HostPort: string }> | undefined>;
      };
    };
    const hostPort = Number(info.NetworkSettings.Ports["8080/tcp"]?.[0]?.HostPort);
    const state: DockerSandboxHandleState = {
      containerId,
      containerName: name,
      hostPort,
      containerPort: 8080,
    };
    return { driverKind: DOCKER_KIND, instanceId: label, handle: state } satisfies SandboxHandle;
  });
}

describe("DockerSandboxProvider lifecycle (Docker-guarded, AC-L5/L6)", () => {
  vitIt.effect("status reports running for a running container", () =>
    Effect.gen(function* () {
      const handle = yield* startAlpineContainerWithPort("status-running");
      yield* Effect.gen(function* () {
        const status = yield* providerWithFakeProbe.lifecycle!.status(handle);
        expect(status).toBe("running");
      }).pipe(Effect.ensuring(removeContainer(handle)));
    }),
  );

  vitIt.effect("stop stops the container and status reports stopped", () =>
    Effect.gen(function* () {
      const handle = yield* startAlpineContainerWithPort("stop");
      yield* Effect.gen(function* () {
        yield* providerWithFakeProbe.lifecycle!.stop(handle);
        const status = yield* providerWithFakeProbe.lifecycle!.status(handle);
        expect(status).toBe("stopped");
      }).pipe(Effect.ensuring(removeContainer(handle)));
    }),
  );

  vitIt.effect("stop then start preserves the container filesystem (AC-L5)", () =>
    Effect.gen(function* () {
      const handle = yield* startAlpineContainerWithPort("fs-persist");
      yield* Effect.gen(function* () {
        // Write a marker file while running.
        const write = yield* DockerSandboxProvider.exec(handle, "echo persisted > /tmp/marker.txt");
        expect(write.exitCode).toBe(0);
        // Stop, then start; the filesystem must survive.
        yield* providerWithFakeProbe.lifecycle!.stop(handle);
        const stopped = yield* providerWithFakeProbe.lifecycle!.status(handle);
        expect(stopped).toBe("stopped");
        yield* providerWithFakeProbe.lifecycle!.start(handle, { config: {} });
        const running = yield* providerWithFakeProbe.lifecycle!.status(handle);
        expect(running).toBe("running");
        const read = yield* DockerSandboxProvider.exec(handle, "cat /tmp/marker.txt");
        expect(read.exitCode).toBe(0);
        expect(read.stdout.trim()).toBe("persisted");
      }).pipe(Effect.ensuring(removeContainer(handle)));
    }),
  );

  vitIt.effect("status reports gone after the container is removed (AC-L6)", () =>
    Effect.gen(function* () {
      const handle = yield* startAlpineContainerWithPort("gone");
      yield* removeContainer(handle);
      const status = yield* providerWithFakeProbe.lifecycle!.status(handle);
      expect(status).toBe("gone");
    }),
  );

  vitIt.effect(
    "discover finds an existing container by instance label and reports its status",
    () =>
      Effect.gen(function* () {
        const instanceId = "docker_discover_01";
        yield* assertDockerDaemonReachable();
        // Create a container with the kata.sandbox.instance label (the real
        // provision path sets it); discover must find it by label, not by the
        // deterministic name, so legacy timestamped containers are reclaimed.
        const name = `kata-sandbox-${instanceId}-${Date.now()}`;
        const create = yield* dockerRequest(`/containers/create?name=${name}`, {
          method: "POST",
          body: JSON.stringify({
            Image: INTEGRATION_IMAGE,
            Cmd: ["sh", "-c", "sleep 300"],
            Labels: { "kata.sandbox": "true", "kata.sandbox.instance": instanceId },
          }),
        }).pipe(Effect.mapError((err) => new Error(`container create failed: ${err.message}`)));
        if (create.status >= 300) {
          return yield* Effect.fail(
            new Error(`create failed: ${create.status} ${create.body.slice(0, 200)}`),
          );
        }
        const containerId = (parseJson(create.body) as { Id: string }).Id;
        yield* dockerRequest(`/containers/${containerId}/start`, { method: "POST" }).pipe(
          Effect.mapError((err) => new Error(`start failed: ${err.message}`)),
        );
        yield* Effect.gen(function* () {
          const found = yield* DockerSandboxProvider.lifecycle!.discover!({
            instanceId,
            config: { ...DEFAULT_DOCKER_CONFIG, port: 13773 },
          });
          expect(found).not.toBeNull();
          if (found !== null) {
            expect(found.status).toBe("running");
            const state = found.handle.handle as DockerSandboxHandleState;
            expect(state.containerId).toBe(containerId);
          }
        }).pipe(
          Effect.ensuring(
            dockerRequest(`/containers/${containerId}?force=true`, { method: "DELETE" }).pipe(
              Effect.ignore,
              Effect.asVoid,
            ),
          ),
        );
      }),
  );
});
