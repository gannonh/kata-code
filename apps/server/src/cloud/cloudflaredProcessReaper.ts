/**
 * Reclaims the one `cloudflared tunnel run` process recorded by Kata Code after
 * an unclean exit. Ownership is verified from the pidfile's executable, exact
 * observed command, and process start identity before a signal is sent.
 */
// @effect-diagnostics nodeBuiltinImport:off — intentional Node process control for host reaping
import { execFileSync } from "node:child_process";
import process from "node:process";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { HostProcessPlatform } from "@kata-sh/code-shared/hostProcess";

import { ServerConfig } from "../config.ts";

const PIDFILE_NAME = "managed-endpoint-cloudflared.pid";

const PidfileRecord = Schema.Struct({
  pid: Schema.Number,
  executablePath: Schema.String,
  command: Schema.String,
  startedAt: Schema.String,
});
type PidfileRecord = typeof PidfileRecord.Type;

const PidfileJson = Schema.fromJsonString(PidfileRecord);
const decodePidfileJson = Schema.decodeEffect(PidfileJson);
const encodePidfileJson = Schema.encodeEffect(PidfileJson);

export interface CloudflaredProcessReaperShape {
  /** Reclaim the verified pidfile owner, if it belongs to this executable. */
  readonly reclaim: (executablePath: string) => Effect.Effect<readonly number[]>;
  /** Reclaim the verified pidfile owner, then clear stale ownership state. */
  readonly reclaimPidfileAndClear: () => Effect.Effect<readonly number[]>;
  readonly writePidfile: (input: {
    readonly pid: number;
    readonly executablePath: string;
  }) => Effect.Effect<void>;
  readonly clearPidfile: () => Effect.Effect<void>;
}

export class CloudflaredProcessReaper extends Context.Service<
  CloudflaredProcessReaper,
  CloudflaredProcessReaperShape
>()("@kata-sh/code-cli/cloud/cloudflaredProcessReaper") {}

export function isCloudflaredTunnelRunCommand(command: string, executablePath: string): boolean {
  return command === `${executablePath} tunnel run`;
}

export interface CloudflaredProcessIdentity {
  readonly command: string;
  readonly startedAt: string;
}

export interface CloudflaredProcessControl {
  readonly inspect: (pid: number, platform: NodeJS.Platform) => CloudflaredProcessIdentity | null;
  readonly kill: (pid: number) => boolean;
}

function inspectProcess(pid: number, platform: NodeJS.Platform): CloudflaredProcessIdentity | null {
  if (platform === "win32") return null;
  try {
    const stdout = execFileSync("ps", ["-p", String(pid), "-o", "lstart=", "-o", "command="], {
      encoding: "utf8",
    }).trim();
    const match = /^(\S+\s+\S+\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/u.exec(stdout);
    if (!match?.[1] || !match[2]) return null;
    return { startedAt: match[1], command: match[2] };
  } catch {
    return null;
  }
}

function killPid(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }
  return true;
}

const liveProcessControl: CloudflaredProcessControl = { inspect: inspectProcess, kill: killPid };

export const makeCloudflaredProcessReaper = Effect.fn("cloudflaredProcessReaper.make")(function* (
  pidfilePath: string,
  processControl: CloudflaredProcessControl = liveProcessControl,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const platform = yield* HostProcessPlatform;

  const readPidfile = Effect.gen(function* () {
    if (!(yield* fileSystem.exists(pidfilePath))) return null as PidfileRecord | null;
    const raw = yield* fileSystem.readFileString(pidfilePath).pipe(Effect.option);
    if (Option.isNone(raw)) return null;
    return yield* decodePidfileJson(raw.value).pipe(Effect.option, Effect.map(Option.getOrNull));
  }).pipe(Effect.orElseSucceed(() => null as PidfileRecord | null));

  const clearPidfile: CloudflaredProcessReaperShape["clearPidfile"] = () =>
    fileSystem.remove(pidfilePath, { force: true }).pipe(Effect.ignore);

  const writePidfile: CloudflaredProcessReaperShape["writePidfile"] = (input) =>
    Effect.gen(function* () {
      const identity = processControl.inspect(input.pid, platform);
      if (
        identity === null ||
        !isCloudflaredTunnelRunCommand(identity.command, input.executablePath)
      ) {
        yield* Effect.logWarning(
          "Could not verify cloudflared process ownership; pidfile omitted",
          {
            pid: input.pid,
          },
        );
        return;
      }
      yield* fileSystem.makeDirectory(pathService.dirname(pidfilePath), { recursive: true });
      const encoded = yield* encodePidfileJson({ ...input, ...identity });
      yield* fileSystem.writeFileString(pidfilePath, `${encoded}\n`);
    }).pipe(Effect.ignore);

  const reclaimRecord = (record: PidfileRecord, executablePath: string) =>
    Effect.sync(() => {
      if (record.executablePath !== executablePath) return [] as readonly number[];
      const current = processControl.inspect(record.pid, platform);
      if (
        current === null ||
        current.command !== record.command ||
        current.startedAt !== record.startedAt ||
        !isCloudflaredTunnelRunCommand(current.command, record.executablePath)
      ) {
        return [] as readonly number[];
      }
      return processControl.kill(record.pid) ? ([record.pid] as const) : ([] as const);
    });

  const reclaim: CloudflaredProcessReaperShape["reclaim"] = (executablePath) =>
    Effect.gen(function* () {
      const record = yield* readPidfile;
      const killed = record ? yield* reclaimRecord(record, executablePath) : ([] as const);
      yield* clearPidfile();
      if (killed.length > 0) {
        yield* Effect.logInfo("Reclaimed owned cloudflared tunnel process", {
          executablePath,
          pids: killed,
        });
      }
      return killed;
    });

  const reclaimPidfileAndClear: CloudflaredProcessReaperShape["reclaimPidfileAndClear"] = () =>
    Effect.gen(function* () {
      const record = yield* readPidfile;
      return record ? yield* reclaim(record.executablePath) : ([] as const);
    }).pipe(Effect.ensuring(clearPidfile()));

  return CloudflaredProcessReaper.of({
    reclaim,
    reclaimPidfileAndClear,
    writePidfile,
    clearPidfile,
  });
});

export const layer = Layer.effect(
  CloudflaredProcessReaper,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const path = yield* Path.Path;
    return yield* makeCloudflaredProcessReaper(path.join(config.stateDir, PIDFILE_NAME));
  }),
);

export const layerTest = (pidfilePath: string, processControl?: CloudflaredProcessControl) =>
  Layer.effect(CloudflaredProcessReaper, makeCloudflaredProcessReaper(pidfilePath, processControl));
