/**
 * Reclaims orphaned `cloudflared tunnel run` processes left behind when the
 * server exits uncleanly (force-quit, SIGKILL, crash) before Scope finalizers run.
 *
 * Matches only the exact resolved executable path so PATH/Docker copies are left alone.
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
});
type PidfileRecord = typeof PidfileRecord.Type;

const PidfileJson = Schema.fromJsonString(PidfileRecord);
const decodePidfileJson = Schema.decodeEffect(PidfileJson);
const encodePidfileJson = Schema.encodeEffect(PidfileJson);

export interface CloudflaredProcessReaperShape {
  /** Kill pidfile target (if alive) and any host `tunnel run` for `executablePath`. */
  readonly reclaim: (executablePath: string) => Effect.Effect<readonly number[]>;
  /** Kill whatever the pidfile points at (if any), then clear it. Used on disable. */
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
  if (!command.includes(executablePath)) {
    return false;
  }
  return /\btunnel\s+run\b/.test(command);
}

export type ProcessListing = ReadonlyArray<{
  readonly pid: number;
  readonly command: string;
}>;

export function parsePsEoPidCommand(stdout: string): ProcessListing {
  const listing: Array<{ pid: number; command: string }> = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number.parseInt(match[1] ?? "", 10);
    const command = match[2];
    if (!Number.isInteger(pid) || typeof command !== "string" || command.length === 0) {
      continue;
    }
    listing.push({ pid, command });
  }
  return listing;
}

export function findTunnelRunPids(
  listing: ProcessListing,
  executablePath: string,
  selfPid: number = process.pid,
): number[] {
  const pids: number[] = [];
  for (const entry of listing) {
    if (entry.pid === selfPid) continue;
    if (isCloudflaredTunnelRunCommand(entry.command, executablePath)) {
      pids.push(entry.pid);
    }
  }
  return pids;
}

function listHostProcesses(platform: NodeJS.Platform): ProcessListing {
  if (platform === "win32") {
    return [];
  }
  try {
    const stdout = execFileSync("ps", ["-eo", "pid=,command="], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return parsePsEoPidCommand(stdout);
  } catch {
    return [];
  }
}

function commandForPid(pid: number, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return "";
  }
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function killPid(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      return false;
    }
    return true;
  }
  try {
    process.kill(pid, 0);
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone after SIGTERM.
  }
  return true;
}

function killMatchingPids(
  pids: ReadonlyArray<number>,
  executablePath: string,
  platform: NodeJS.Platform,
): number[] {
  const killed: number[] = [];
  for (const pid of pids) {
    const command = commandForPid(pid, platform);
    if (command.length > 0 && !isCloudflaredTunnelRunCommand(command, executablePath)) {
      continue;
    }
    if (killPid(pid)) {
      killed.push(pid);
    }
  }
  return killed;
}

export const makeCloudflaredProcessReaper = Effect.fn("cloudflaredProcessReaper.make")(function* (
  pidfilePath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const platform = yield* HostProcessPlatform;

  const readPidfile = Effect.gen(function* () {
    const exists = yield* fileSystem.exists(pidfilePath);
    if (!exists) {
      return null as PidfileRecord | null;
    }
    const raw = yield* fileSystem.readFileString(pidfilePath).pipe(Effect.option);
    if (Option.isNone(raw)) {
      return null;
    }
    return yield* decodePidfileJson(raw.value).pipe(Effect.option, Effect.map(Option.getOrNull));
  }).pipe(Effect.orElseSucceed(() => null as PidfileRecord | null));

  const clearPidfile: CloudflaredProcessReaperShape["clearPidfile"] = () =>
    fileSystem.remove(pidfilePath, { force: true }).pipe(Effect.ignore);

  const writePidfile: CloudflaredProcessReaperShape["writePidfile"] = (input) =>
    Effect.gen(function* () {
      yield* fileSystem.makeDirectory(pathService.dirname(pidfilePath), { recursive: true });
      const encoded = yield* encodePidfileJson({
        pid: input.pid,
        executablePath: input.executablePath,
      });
      yield* fileSystem.writeFileString(pidfilePath, `${encoded}\n`);
    }).pipe(Effect.ignore);

  const reclaim: CloudflaredProcessReaperShape["reclaim"] = (executablePath) =>
    Effect.gen(function* () {
      const killed = new Set<number>();
      const record = yield* readPidfile;
      if (record) {
        for (const pid of killMatchingPids([record.pid], record.executablePath, platform)) {
          killed.add(pid);
        }
      }
      for (const pid of findTunnelRunPids(listHostProcesses(platform), executablePath)) {
        if (killPid(pid)) {
          killed.add(pid);
        }
      }
      if (killed.size > 0) {
        yield* Effect.logInfo("Reclaimed orphaned cloudflared tunnel process(es)", {
          executablePath,
          pids: [...killed],
        });
      }
      return [...killed] as const;
    });

  const reclaimPidfileAndClear: CloudflaredProcessReaperShape["reclaimPidfileAndClear"] = () =>
    Effect.gen(function* () {
      const record = yield* readPidfile;
      const killed = record ? yield* reclaim(record.executablePath) : ([] as const);
      yield* clearPidfile();
      return killed;
    });

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

export const layerTest = (pidfilePath: string) =>
  Layer.effect(CloudflaredProcessReaper, makeCloudflaredProcessReaper(pidfilePath));
