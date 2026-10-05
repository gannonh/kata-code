import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, expect, it } from "@effect/vitest";
import {
  HostProcessArguments,
  HostProcessExecutablePath,
  HostProcessIsExecutable,
  HostProcessPlatform,
} from "@kata-sh/code-shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { formatCliCommand, resolveServerInstallation } from "./invocation.ts";

it("formats package runner commands from their cache entry paths", () => {
  for (const [entryPath, expected] of [
    ["/home/theo/.npm/_npx/abc123/node_modules/t3/dist/bin.mjs", "npx @kata-sh/code-cli serve"],
    [
      "C:\\Users\\theo\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\t3\\dist\\bin.mjs",
      "npx @kata-sh/code-cli serve",
    ],
    [
      "/home/theo/.cache/pnpm/dlx/abc/node_modules/t3/dist/bin.mjs",
      "pnpm dlx @kata-sh/code-cli serve",
    ],
    [
      "/home/theo/.local/share/pnpm/.pnpm/dlx/abc/node_modules/t3/dist/bin.mjs",
      "pnpm dlx @kata-sh/code-cli serve",
    ],
    [
      "C:\\Users\\theo\\AppData\\Local\\pnpm-cache\\dlx\\abc\\node_modules\\t3\\dist\\bin.mjs",
      "pnpm dlx @kata-sh/code-cli serve",
    ],
    ["/home/theo/.bun/install/cache/t3@0.0.31/dist/bin.mjs", "bunx @kata-sh/code-cli serve"],
    ["/tmp/bunx-1000-t3@latest/node_modules/t3/dist/bin.mjs", "bunx @kata-sh/code-cli serve"],
    [
      "C:\\Users\\theo\\AppData\\Local\\Temp\\bunx-0-t3@latest\\node_modules\\t3\\dist\\bin.mjs",
      "bunx @kata-sh/code-cli serve",
    ],
  ] as const) {
    assert.equal(formatCliCommand({ subcommand: "serve", entryPath, version: "0.0.31" }), expected);
  }
});

it("treats stable installs as direct invocations", () => {
  for (const entryPath of [
    "/usr/local/lib/node_modules/t3/dist/bin.mjs",
    "/home/theo/Code/work/t3code/apps/server/dist/bin.mjs",
    "/home/theo/.t3/runtime/0.0.31/node_modules/t3/dist/bin.mjs",
    "",
  ]) {
    assert.equal(
      formatCliCommand({ subcommand: "serve", entryPath, version: "0.0.31" }),
      "katacode serve",
    );
  }
});

it("re-suggests the prerelease channel only for prerelease builds", () => {
  for (const [version, expected] of [
    ["0.0.31-nightly.20260729", "npx @kata-sh/code-cli@nightly serve"],
    ["0.0.31-preview.20260729.1", "npx @kata-sh/code-cli@preview serve"],
    ["0.0.31-foo-preview.20260729.1", "npx @kata-sh/code-cli serve"],
    ["0.0.31", "npx @kata-sh/code-cli serve"],
  ] as const) {
    assert.equal(
      formatCliCommand({
        subcommand: "serve",
        entryPath: "/home/theo/.npm/_npx/abc123/node_modules/t3/dist/bin.mjs",
        version,
      }),
      expected,
    );
  }
});

it("formats serve suggestions to match the launching command", () => {
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/home/theo/.npm/_npx/abc/node_modules/t3/dist/bin.mjs",
      version: "0.0.31-nightly.20260729",
    }),
    "npx @kata-sh/code-cli@nightly serve",
  );
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/tmp/bunx-1000-@kata-sh/code-cli@latest/node_modules/t3/dist/bin.mjs",
      version: "0.0.31",
    }),
    "bunx @kata-sh/code-cli serve",
  );
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/usr/local/lib/node_modules/t3/dist/bin.mjs",
      version: "0.0.31-nightly.20260729",
    }),
    "katacode serve",
  );
});

it.layer(NodeServices.layer)("manual server installation ownership", (it) => {
  it.effect("recognizes runner caches for both script and executable packages", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      for (const [relative, kind] of [
        ["npm/_npx/hash/node_modules/@kata-sh/code-cli/dist/bin.mjs", "npx"],
        ["npm/_npx/hash/node_modules/@kata-sh/code-cli-linux-x64/katacode", "npx"],
        ["pnpm/dlx/hash/node_modules/@kata-sh/code-cli/dist/bin.mjs", "pnpm-dlx"],
        [".bun/install/cache/@kata-sh/code-cli/dist/bin.mjs", "bunx"],
      ] as const) {
        const entry = path.join(root, relative);
        yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
        yield* fs.writeFileString(entry, "");
        const installation = yield* resolveServerInstallation.pipe(
          Effect.provideService(HostProcessArguments, ["node", entry]),
          Effect.provideService(HostProcessExecutablePath, entry),
          Effect.provideService(HostProcessIsExecutable, entry.endsWith("/katacode")),
        );
        expect(installation).toEqual({ kind });
      }
    }),
  );

  it.effect("requires the npm prefix's bin to point to the running package", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const prefix = path.join(root, "bunx-tools");
      const packageRoot = path.join(prefix, "lib/node_modules/@kata-sh/code-cli");
      const entry = path.join(packageRoot, "dist/bin.mjs");
      const globalBin = path.join(prefix, "bin/katacode");
      yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
      yield* fs.makeDirectory(path.dirname(globalBin), { recursive: true });
      yield* fs.writeFileString(entry, "");
      yield* fs.writeFileString(
        path.join(packageRoot, "package.json"),
        '{"name":"@kata-sh/code-cli","version":"0.0.45","bin":{"katacode":"./dist/bin.mjs"}}',
      );
      const resolve = resolveServerInstallation.pipe(
        Effect.provideService(HostProcessArguments, ["node", entry]),
        Effect.provideService(HostProcessIsExecutable, false),
        Effect.provideService(HostProcessPlatform, "linux"),
      );
      expect(yield* resolve).toBeNull();
      yield* fs.symlink(entry, globalBin);
      expect(yield* resolve).toEqual({ kind: "npm-global", prefix });
      yield* fs.remove(globalBin);
      yield* fs.writeFileString(globalBin, "an unrelated katacode command");
      expect(yield* resolve).toBeNull();
      expect(yield* resolve.pipe(Effect.provideService(HostProcessPlatform, "win32"))).toBeNull();
    }),
  );

  it.effect("proves the native executable belongs to the npm launcher", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const prefix = path.join(root, "bunx-tools");
      const packageRoot = path.join(prefix, "lib/node_modules/@kata-sh/code-cli");
      const launcher = path.join(packageRoot, "bin/katacode.js");
      const entry = path.join(packageRoot, "node_modules/@kata-sh/code-cli-linux-x64/katacode");
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
      yield* fs.makeDirectory(path.join(prefix, "bin"));
      yield* fs.writeFileString(launcher, "");
      yield* fs.writeFileString(entry, "");
      yield* fs.writeFileString(
        path.join(packageRoot, "package.json"),
        '{"name":"@kata-sh/code-cli","version":"0.0.45","bin":{"katacode":"./bin/katacode.js"},"optionalDependencies":{"@kata-sh/code-cli-linux-x64":"0.0.45"}}',
      );
      yield* fs.symlink(launcher, path.join(prefix, "bin/katacode"));
      const resolve = resolveServerInstallation.pipe(
        Effect.provideService(HostProcessExecutablePath, entry),
        Effect.provideService(HostProcessIsExecutable, true),
        Effect.provideService(HostProcessPlatform, "linux"),
      );
      for (const [version, expected] of [
        ["0.0.44", null],
        ["0.0.45", { kind: "npm-global", prefix }],
      ]) {
        yield* fs.writeFileString(
          path.join(path.dirname(entry), "package.json"),
          `{"name":"@kata-sh/code-cli-linux-x64","version":"${version}"}`,
        );
        expect(yield* resolve).toEqual(expected);
      }
    }),
  );

  it.effect("leaves local, standalone, missing and unreadable installs unknown", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      for (const relative of [
        "project/node_modules/@kata-sh/code-cli/dist/bin.mjs",
        "project/apps/server/dist/bin.mjs",
        ".katacode/runtime/0.0.45/katacode",
        "missing/dist/bin.mjs",
      ]) {
        const entry = path.join(root, relative);
        if (!relative.startsWith("missing")) {
          yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
          yield* fs.writeFileString(entry, "");
        }
        expect(
          yield* resolveServerInstallation.pipe(
            Effect.provideService(HostProcessArguments, ["node", entry]),
            Effect.provideService(HostProcessIsExecutable, false),
          ),
        ).toBeNull();
      }
    }),
  );
});
