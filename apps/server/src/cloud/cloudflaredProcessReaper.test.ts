import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  CloudflaredProcessReaper,
  findTunnelRunPids,
  isCloudflaredTunnelRunCommand,
  layerTest,
  parsePsEoPidCommand,
} from "./cloudflaredProcessReaper.ts";

const PidfileRecord = Schema.Struct({
  pid: Schema.Number,
  executablePath: Schema.String,
});
const decodePidfile = Schema.decodeEffect(Schema.fromJsonString(PidfileRecord));

describe("cloudflaredProcessReaper helpers", () => {
  it("matches only the resolved executable with tunnel run args", () => {
    const managed = "/Users/me/.katacode/tools/cloudflared/2026.5.2/darwin-arm64/cloudflared";
    expect(isCloudflaredTunnelRunCommand(`${managed} tunnel run`, managed)).toBe(true);
    expect(isCloudflaredTunnelRunCommand(`/usr/local/bin/cloudflared tunnel run`, managed)).toBe(
      false,
    );
    expect(isCloudflaredTunnelRunCommand(`${managed} --version`, managed)).toBe(false);
  });

  it("parses ps listings and finds tunnel run pids", () => {
    const managed = "/tmp/tools/cloudflared/bin/cloudflared";
    const listing = parsePsEoPidCommand(`
  11 /sbin/launchd
  42 ${managed} tunnel run
  43 /usr/bin/cloudflared tunnel run
  44 ${managed} --help
`);
    expect(findTunnelRunPids(listing, managed, 1)).toEqual([42]);
  });
});

describe("CloudflaredProcessReaper pidfile", () => {
  it("writes and clears the pidfile under the configured path", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectory({ prefix: "katacode-cloudflared-reaper-" });
        const pidfilePath = path.join(dir, "managed-endpoint-cloudflared.pid");

        yield* Effect.gen(function* () {
          const reaper = yield* CloudflaredProcessReaper;
          yield* reaper.writePidfile({
            pid: 12_345,
            executablePath: "/tmp/fake-cloudflared",
          });
          const raw = yield* fs.readFileString(pidfilePath);
          const decoded = yield* decodePidfile(raw.trim());
          expect(decoded).toEqual({
            pid: 12_345,
            executablePath: "/tmp/fake-cloudflared",
          });
          yield* reaper.clearPidfile();
          expect(yield* fs.exists(pidfilePath)).toBe(false);
        }).pipe(Effect.provide(layerTest(pidfilePath)));

        yield* fs.remove(dir, { recursive: true, force: true });
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
    );
  });
});
