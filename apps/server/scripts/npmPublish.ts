import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { resolveSpawnCommand } from "@kata-sh/code-shared/shell";
import { ServerCliBuildAssetMissingError } from "./cliErrors.ts";
import { runCommand } from "./runCommand.ts";

const PackageManifest = Schema.Struct({ name: Schema.String, version: Schema.String });
const decodePackageManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(PackageManifest));

export interface NpmPublishOptions {
  readonly packagesDir: string;
  readonly tag: string;
  readonly access: string;
  readonly provenance: boolean;
  readonly dryRun: boolean;
  readonly verbose: boolean;
  /** Wait between attempts at one tarball. */
  readonly retryDelay?: Duration.Input;
}

/** Attempts per tarball; retries cover a failed npm trusted-publishing token exchange. */
const PUBLISH_ATTEMPTS = 3;

const isPublished = Effect.fn("isPublished")(function* (name: string, version: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const spawnCommand = yield* resolveSpawnCommand("npm", ["view", `${name}@${version}`, "version"]);
  // An unknown package or version prints nothing, so any other failure also
  // reads as unpublished and the publish attempt reports it.
  const output = yield* spawner
    .string(
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        stderr: "ignore",
        shell: spawnCommand.shell,
      }),
    )
    .pipe(Effect.orElseSucceed(() => ""));
  return output.trim() === version;
});

/**
 * Publishes the tarballs scripts/build-npm-platform-packages.ts produced:
 * every `@kata-sh/code-cli-<platform>.tgz` first, `@kata-sh/code-cli.tgz`
 * (the launcher) last, so the launcher is never installable before the
 * executables it depends on. Tarballs rather than directories because
 * `npm publish <dir>` strips the `node_modules/` the executable loads its
 * native addons from.
 *
 * A version already on the registry counts as published, so rerunning a
 * release whose publish stopped partway finishes the remaining packages.
 */
export const publishNpmTarballs = Effect.fn("publishNpmTarballs")(function* (
  options: NpmPublishOptions,
) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  // npm runs with cwd set to the packages dir below, so tarball paths are
  // resolved once here rather than joined twice.
  const packagesDir = path.resolve(options.packagesDir);
  const scopeDir = path.join(packagesDir, "@kata-sh");
  const launcherTarball = path.join(scopeDir, "code-cli.tgz");
  const platformTarballs = (yield* fs
    .readDirectory(scopeDir)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => [])))
    .filter((entry) => entry.startsWith("code-cli-") && entry.endsWith(".tgz"))
    .sort()
    .map((entry) => path.join(scopeDir, entry));
  if (platformTarballs.length === 0) {
    return yield* new ServerCliBuildAssetMissingError({
      assetPath: path.join(scopeDir, "code-cli-<platform>.tgz"),
    });
  }
  if (!(yield* fs.exists(launcherTarball))) {
    return yield* new ServerCliBuildAssetMissingError({ assetPath: launcherTarball });
  }

  const args = ["publish", "--access", options.access, "--tag", options.tag];
  if (options.provenance) args.push("--provenance");
  if (options.dryRun) args.push("--dry-run");

  for (const tarball of [...platformTarballs, launcherTarball]) {
    // build-npm-platform-packages.ts writes each package directory beside its tarball.
    const { name, version } = yield* decodePackageManifest(
      yield* fs.readFileString(path.join(tarball.slice(0, -".tgz".length), "package.json")),
    );
    const spawnCommand = yield* resolveSpawnCommand("npm", [...args, tarball]);

    const publishOnce = Effect.gen(function* () {
      if (yield* isPublished(name, version)) {
        yield* Effect.log(`[cli] ${name}@${version} is already on the registry; skipping`);
        return;
      }
      yield* Effect.log(`[cli] npm ${args.join(" ")} ${path.basename(tarball)}`);
      yield* runCommand(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          cwd: packagesDir,
          stdout: options.verbose ? "inherit" : "ignore",
          stderr: "inherit",
          shell: spawnCommand.shell,
        }),
      );
    });

    yield* publishOnce.pipe(
      Effect.tapError((error) =>
        Effect.logWarning(`[cli] Publishing ${name}@${version} failed: ${error.message}`),
      ),
      Effect.retry({
        times: PUBLISH_ATTEMPTS - 1,
        schedule: Schedule.spaced(options.retryDelay ?? "15 seconds"),
      }),
    );
  }
});
