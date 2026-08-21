#!/usr/bin/env node
/**
 * prepare-github-release.ts — rename installers, refresh updater manifests,
 * and render the GitHub release body for a desktop release.
 *
 * Renames electron-builder's version-encoded artifacts to stable, friendly
 * names, rewrites updater manifests to reference the new names, and writes
 * `release-body.md` with a per-platform download table. The GitHub release
 * action pre-pends this body to its auto-generated release notes.
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

import { prepareReleaseAssets } from "./release-asset-names.ts";

interface CliArgs {
  readonly dist: string;
  readonly repository: string;
  readonly tag: string;
  readonly version: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: {
    dist?: string | undefined;
    repository?: string | undefined;
    tag?: string | undefined;
    version?: string | undefined;
  } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--dist":
        args.dist = value;
        i += 1;
        break;
      case "--repository":
        args.repository = value;
        i += 1;
        break;
      case "--tag":
        args.tag = value;
        i += 1;
        break;
      case "--version":
        args.version = value;
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }

  const { dist, repository, tag, version } = args;
  if (!dist || !repository || !tag || !version) {
    throw new Error(
      "Usage: prepare-github-release.ts --dist <dir> --repository owner/repo --tag vX.Y.Z --version X.Y.Z",
    );
  }
  return { dist, repository, tag, version };
}

const program = Effect.gen(function* () {
  const { dist, repository, tag, version } = parseArgs(process.argv.slice(2));
  const result = yield* prepareReleaseAssets({
    distDir: dist,
    repository,
    tag,
    version,
  });

  yield* Console.log(`Wrote release body to ${result.bodyPath}`);
  for (const fileName of result.fileNames) {
    if (fileName !== "release-body.md") {
      yield* Console.log(fileName);
    }
  }
});

if (import.meta.main) {
  program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
