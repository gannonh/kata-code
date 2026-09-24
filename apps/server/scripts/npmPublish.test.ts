import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { publishNpmTarballs } from "./npmPublish.ts";

const VERSION = "0.0.43-nightly.20260924.1231";

interface FakeRegistry {
  readonly published: Set<string>;
  /** Publish attempts per package name that fail before one succeeds. */
  readonly failuresBeforeSuccess: Map<string, number>;
  readonly publishAttempts: Array<string>;
}

function makeProcess(output: string, exitCode: number): ChildProcessSpawner.ChildProcessHandle {
  const stdout = output.length === 0 ? Stream.empty : Stream.make(new TextEncoder().encode(output));
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(123),
    stdout,
    stderr: Stream.empty,
    all: stdout,
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
}

/** Answers `npm view <name>@<version> version` and `npm publish <tarball>` like the registry. */
function fakeNpm(registry: FakeRegistry, packagesDir: string) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        const { args } = command as ChildProcess.StandardCommand;
        if (args[0] === "view") {
          const spec = args[1]!;
          return makeProcess(registry.published.has(spec) ? `${VERSION}\n` : "", 0);
        }
        const tarball = args.at(-1)!;
        const name = tarball.slice(packagesDir.length + 1, -".tgz".length);
        registry.publishAttempts.push(name);
        const remainingFailures = registry.failuresBeforeSuccess.get(name) ?? 0;
        if (remainingFailures > 0) {
          registry.failuresBeforeSuccess.set(name, remainingFailures - 1);
          return makeProcess("", 1);
        }
        registry.published.add(`${name}@${VERSION}`);
        return makeProcess("", 0);
      }),
    ),
  );
}

const writePackages = Effect.fn("writePackages")(function* (names: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const packagesDir = yield* fs.makeTempDirectoryScoped();
  for (const name of names) {
    const packageDir = path.join(packagesDir, name);
    yield* fs.makeDirectory(packageDir, { recursive: true });
    yield* fs.writeFileString(
      path.join(packageDir, "package.json"),
      `{"name":"${name}","version":"${VERSION}"}`,
    );
    yield* fs.writeFileString(`${packageDir}.tgz`, "");
  }
  return packagesDir;
});

const publish = (packagesDir: string, registry: FakeRegistry) =>
  publishNpmTarballs({
    packagesDir,
    tag: "nightly",
    access: "public",
    provenance: true,
    dryRun: false,
    verbose: false,
    retryDelay: "0 millis",
  }).pipe(Effect.provide(fakeNpm(registry, packagesDir)));

it.layer(NodeServices.layer)("publishNpmTarballs", (it) => {
  describe("a rerun after a partial publish", () => {
    it.effect("skips published platforms and retries the launcher until it publishes", () =>
      Effect.gen(function* () {
        const packagesDir = yield* writePackages([
          "@kata-sh/code-cli-linux-x64",
          "@kata-sh/code-cli-win32-x64",
          "@kata-sh/code-cli",
        ]);
        const registry: FakeRegistry = {
          published: new Set([
            `@kata-sh/code-cli-linux-x64@${VERSION}`,
            `@kata-sh/code-cli-win32-x64@${VERSION}`,
          ]),
          failuresBeforeSuccess: new Map([["@kata-sh/code-cli", 1]]),
          publishAttempts: [],
        };

        yield* publish(packagesDir, registry);

        assert.deepStrictEqual(registry.publishAttempts, [
          "@kata-sh/code-cli",
          "@kata-sh/code-cli",
        ]);
        assert.isTrue(registry.published.has(`@kata-sh/code-cli@${VERSION}`));
      }),
    );
  });

  it.effect("fails after three failed attempts at one package", () =>
    Effect.gen(function* () {
      const packagesDir = yield* writePackages([
        "@kata-sh/code-cli-linux-x64",
        "@kata-sh/code-cli",
      ]);
      const registry: FakeRegistry = {
        published: new Set(),
        failuresBeforeSuccess: new Map([["@kata-sh/code-cli-linux-x64", 3]]),
        publishAttempts: [],
      };

      const exit = yield* Effect.exit(publish(packagesDir, registry));

      assert.isTrue(exit._tag === "Failure");
      assert.deepStrictEqual(registry.publishAttempts, [
        "@kata-sh/code-cli-linux-x64",
        "@kata-sh/code-cli-linux-x64",
        "@kata-sh/code-cli-linux-x64",
      ]);
    }),
  );
});
