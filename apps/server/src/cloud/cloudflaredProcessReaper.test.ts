import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessPlatform } from "@kata-sh/code-shared/hostProcess";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  type CloudflaredProcessControl,
  type CloudflaredProcessReaperShape,
  CloudflaredProcessReaper,
  isCloudflaredTunnelRunCommand,
  layerTest,
} from "./cloudflaredProcessReaper.ts";

const PidfileRecord = Schema.Struct({
  pid: Schema.Number,
  executablePath: Schema.String,
  command: Schema.String,
  startedAt: Schema.String,
});
const PidfileJson = Schema.fromJsonString(PidfileRecord);
const decodePidfile = Schema.decodeEffect(PidfileJson);
const encodePidfile = Schema.encodeEffect(PidfileJson);

const executablePath = "/tmp/fake-cloudflared";
const ownedIdentity = {
  command: `${executablePath} tunnel run`,
  startedAt: "Sun Jul 12 13:00:00 2026",
};

function withReaper<E>(
  processControl: CloudflaredProcessControl,
  run: (input: {
    readonly reaper: CloudflaredProcessReaperShape;
    readonly fs: FileSystem.FileSystem;
    readonly pidfilePath: string;
  }) => Effect.Effect<void, E>,
  platform: NodeJS.Platform = "linux",
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectory({ prefix: "katacode-cloudflared-reaper-" });
    const pidfilePath = path.join(dir, "managed-endpoint-cloudflared.pid");
    yield* Effect.gen(function* () {
      const reaper = yield* CloudflaredProcessReaper;
      yield* run({ reaper, fs, pidfilePath });
    }).pipe(Effect.provide(layerTest(pidfilePath, processControl)));
    yield* fs.remove(dir, { recursive: true, force: true });
  }).pipe(
    Effect.provideService(HostProcessPlatform, platform),
    Effect.provide(NodeServices.layer),
    Effect.scoped,
  );
}

describe("cloudflaredProcessReaper ownership", () => {
  it("requires the exact spawned argv", () => {
    expect(isCloudflaredTunnelRunCommand(ownedIdentity.command, executablePath)).toBe(true);
    expect(
      isCloudflaredTunnelRunCommand(`${executablePath} tunnel run unrelated`, executablePath),
    ).toBe(false);
    expect(
      isCloudflaredTunnelRunCommand("/usr/local/bin/cloudflared tunnel run", executablePath),
    ).toBe(false);
  });

  it.effect("persists verified identity and reclaims the same process", () => {
    const killed: number[] = [];
    const control: CloudflaredProcessControl = {
      inspect: () => ownedIdentity,
      kill: (pid) => {
        killed.push(pid);
        return true;
      },
    };
    return withReaper(control, ({ reaper, fs, pidfilePath }) =>
      Effect.gen(function* () {
        yield* reaper.writePidfile({ pid: 12_345, executablePath });
        const decoded = yield* fs.readFileString(pidfilePath).pipe(Effect.flatMap(decodePidfile));
        expect(decoded).toEqual({ pid: 12_345, executablePath, ...ownedIdentity });
        expect(yield* reaper.reclaim(executablePath)).toEqual([12_345]);
        expect(killed).toEqual([12_345]);
        expect(yield* fs.exists(pidfilePath)).toBe(false);
      }),
    );
  });

  it.effect("rejects PID reuse with a different start identity and clears stale state", () => {
    const killed: number[] = [];
    let identity = ownedIdentity;
    const control: CloudflaredProcessControl = {
      inspect: () => identity,
      kill: (pid) => {
        killed.push(pid);
        return true;
      },
    };
    return withReaper(control, ({ reaper, fs, pidfilePath }) =>
      Effect.gen(function* () {
        yield* reaper.writePidfile({ pid: 44, executablePath });
        identity = { ...ownedIdentity, startedAt: "Sun Jul 12 14:00:00 2026" };
        expect(yield* reaper.reclaim(executablePath)).toEqual([]);
        expect(killed).toEqual([]);
        expect(yield* fs.exists(pidfilePath)).toBe(false);
      }),
    );
  });

  it.effect("rejects a changed command for the same PID and start identity", () => {
    const killed: number[] = [];
    let identity = ownedIdentity;
    const control: CloudflaredProcessControl = {
      inspect: () => identity,
      kill: (pid) => {
        killed.push(pid);
        return true;
      },
    };
    return withReaper(control, ({ reaper, fs, pidfilePath }) =>
      Effect.gen(function* () {
        yield* reaper.writePidfile({ pid: 45, executablePath });
        identity = { ...ownedIdentity, command: `${executablePath} tunnel run replaced` };
        expect(yield* reaper.reclaim(executablePath)).toEqual([]);
        expect(killed).toEqual([]);
        expect(yield* fs.exists(pidfilePath)).toBe(false);
      }),
    );
  });

  it.effect("does not kill when command identity is unavailable", () => {
    let available = true;
    let killCalled = false;
    const control: CloudflaredProcessControl = {
      inspect: () => (available ? ownedIdentity : null),
      kill: () => {
        killCalled = true;
        return true;
      },
    };
    return withReaper(control, ({ reaper, fs, pidfilePath }) =>
      Effect.gen(function* () {
        yield* reaper.writePidfile({ pid: 46, executablePath });
        available = false;
        expect(yield* reaper.reclaim(executablePath)).toEqual([]);
        expect(killCalled).toBe(false);
        expect(yield* fs.exists(pidfilePath)).toBe(false);
      }),
    );
  });

  it.effect("clears stale Windows ownership without inspecting or killing", () => {
    let inspectCalled = false;
    let killCalled = false;
    const control: CloudflaredProcessControl = {
      inspect: (_pid, platform) => {
        inspectCalled = true;
        return platform === "win32" ? null : ownedIdentity;
      },
      kill: () => {
        killCalled = true;
        return true;
      },
    };
    return withReaper(
      control,
      ({ reaper, fs, pidfilePath }) =>
        Effect.gen(function* () {
          const encoded = yield* encodePidfile({
            pid: 47,
            executablePath,
            ...ownedIdentity,
          });
          yield* fs.writeFileString(pidfilePath, `${encoded}\n`);
          expect(yield* reaper.reclaim(executablePath)).toEqual([]);
          expect(inspectCalled).toBe(true);
          expect(killCalled).toBe(false);
          expect(yield* fs.exists(pidfilePath)).toBe(false);
        }),
      "win32",
    );
  });

  it.effect("ignores unrelated same-binary tunnels because it never scans the host", () => {
    let inspected = false;
    const control: CloudflaredProcessControl = {
      inspect: () => {
        inspected = true;
        return { ...ownedIdentity, command: `${executablePath} tunnel run unrelated` };
      },
      kill: () => true,
    };
    return withReaper(control, ({ reaper }) =>
      Effect.gen(function* () {
        expect(yield* reaper.reclaim(executablePath)).toEqual([]);
        expect(inspected).toBe(false);
      }),
    );
  });

  it.effect("omits a pidfile when initial ownership cannot be verified", () =>
    withReaper({ inspect: () => null, kill: () => true }, ({ reaper, fs, pidfilePath }) =>
      Effect.gen(function* () {
        yield* reaper.writePidfile({ pid: 48, executablePath });
        expect(yield* fs.exists(pidfilePath)).toBe(false);
      }),
    ),
  );
});
