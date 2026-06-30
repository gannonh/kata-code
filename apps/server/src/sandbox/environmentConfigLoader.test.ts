import * as NodeServices from "@effect/platform-node/NodeServices";
import { RepositoryCanonicalKey, type SavedSandboxEnvironment } from "@kata-sh/code-contracts";
import { assert, it } from "@effect/vitest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { EnvironmentConfigLoadError, loadEnvironmentConfig } from "./environmentConfigLoader.ts";

/** Tagged error for the "load unexpectedly succeeded" assertion path. */
class LoadUnexpectedlySucceeded extends Data.TaggedError("LoadUnexpectedlySucceeded")<{
  readonly message: string;
}> {}

/**
 * RepositoryIdentity the loader keys the saved-env lookup on. Only
 * `canonicalKey` is read; the locator is structurally required but its
 * contents are irrelevant to resolution, so a minimal fixture suffices.
 */
const repoIdentity = (canonicalKey: string) => ({
  canonicalKey: canonicalKey as never,
  locator: {
    source: "git-remote" as const,
    remoteName: "origin" as never,
    remoteUrl: "git@github.com:octocat/t3code.git" as never,
  },
});

/**
 * Build a `savedSandboxEnvironments` map with one entry keyed by the repo's
 * canonical key. The value is a plain `SavedSandboxEnvironment`-shaped object;
 * the loader reads `install`/`start`/`terminals` off it.
 */
const savedEnvs = (canonicalKey: string, env: SavedSandboxEnvironment) => ({
  [RepositoryCanonicalKey.make(canonicalKey)]: env,
});

/**
 * Write a `.kata/environment.json` under `repoRoot` and return the loader
 * input. Uses the real Node FileSystem (provided via `NodeServices.layer`) so
 * the test exercises the actual host-read path.
 */
const withRepoFile = (
  repoRoot: string,
  contents: string,
  savedSandboxEnvironments: Record<string, SavedSandboxEnvironment> = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const kataDir = path.join(repoRoot, ".kata");
    yield* fs.makeDirectory(kataDir, { recursive: true });
    yield* fs.writeFileString(path.join(kataDir, "environment.json"), contents);
    return {
      repoRoot,
      repositoryIdentity: repoIdentity("github.com/octocat/t3code"),
      savedSandboxEnvironments,
    };
  });

/**
 * Run the loader and assert it fails loud with an `EnvironmentConfigLoadError`
 * whose message mentions the substring. Uses `Effect.catchTag` so the error
 * type is narrowed without Cause introspection. A successful load is a test
 * failure (the load must fail loud, not silently succeed).
 */
const assertFailsLoud = (
  input: Parameters<typeof loadEnvironmentConfig>[0],
  messageContains: string,
) =>
  loadEnvironmentConfig(input).pipe(
    // A success means the loader did NOT fail loud: surface that as a failure.
    Effect.flatMap(() =>
      Effect.fail(
        new LoadUnexpectedlySucceeded({
          message: "expected EnvironmentConfigLoadError, but the load succeeded",
        }),
      ),
    ),
    Effect.catchTag("EnvironmentConfigLoadError", (error) =>
      Effect.sync(() => {
        assert.instanceOf(error, EnvironmentConfigLoadError);
        assert.isTrue(error.message.includes(messageContains));
        return true;
      }),
    ),
  );

it.layer(NodeServices.layer)("environmentConfigLoader", (it) => {
  it.effect(
    "a valid .kata/environment.json resolves with repo-file provenance (tracer bullet)",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const repoRoot = yield* fs.makeTempDirectoryScoped({ prefix: "kata-loader-test-" });
        const input = yield* withRepoFile(repoRoot, '{"install":"pnpm i","start":"pnpm dev"}');
        const loaded = yield* loadEnvironmentConfig(input);
        assert.equal(loaded.repoFilePresent, true);
        assert.equal(loaded.resolved.install, "pnpm i");
        assert.equal(loaded.resolved.start, "pnpm dev");
        assert.equal(loaded.resolved.provenance.install, "repo-file");
        assert.equal(loaded.resolved.provenance.start, "repo-file");
      }),
  );

  it.effect(
    "a schema-invalid .kata/environment.json fails loud with EnvironmentConfigLoadError (no silent fallback)",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const repoRoot = yield* fs.makeTempDirectoryScoped({ prefix: "kata-loader-test-" });
        // Schema-invalid: `install` must be a trimmed non-empty string, not a number.
        const input = yield* withRepoFile(repoRoot, '{"install":123}');
        yield* assertFailsLoud(input, "environment.json");
      }),
  );

  it.effect("unparseable JSON in .kata/environment.json fails loud (no silent fallback)", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const repoRoot = yield* fs.makeTempDirectoryScoped({ prefix: "kata-loader-test-" });
      const input = yield* withRepoFile(repoRoot, "{ not valid json ");
      yield* assertFailsLoud(input, "not valid JSON");
    }),
  );

  it.effect(
    "an absent .kata/environment.json falls through to the saved env keyed by canonicalKey (repoFilePresent=false)",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const repoRoot = yield* fs.makeTempDirectoryScoped({ prefix: "kata-loader-test-" });
        // No .kata/environment.json written. A saved env for this repo's
        // canonical key supplies install + a terminal.
        const input = {
          repoRoot,
          repositoryIdentity: repoIdentity("github.com/octocat/t3code"),
          savedSandboxEnvironments: savedEnvs("github.com/octocat/t3code", {
            install: "yarn",
            terminals: [{ name: "web", command: "serve" }],
          }),
        };
        const loaded = yield* loadEnvironmentConfig(input);
        assert.equal(loaded.repoFilePresent, false);
        assert.equal(loaded.resolved.install, "yarn");
        assert.equal(loaded.resolved.provenance.install, "saved-env");
        assert.deepEqual(loaded.resolved.terminals, [{ name: "web", command: "serve" }]);
        assert.equal(loaded.resolved.provenance.terminals, "saved-env");
      }),
  );

  it.effect(
    "repo-file wins over saved-env per field, and saved-env fills fields the repo file omits",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const repoRoot = yield* fs.makeTempDirectoryScoped({ prefix: "kata-loader-test-" });
        // Repo file has install; saved env has install + start. install comes
        // from the repo file (first match wins), start comes from saved-env
        // (the repo file omits it).
        const input = yield* withRepoFile(
          repoRoot,
          '{"install":"pnpm i"}',
          savedEnvs("github.com/octocat/t3code", {
            install: "yarn",
            start: "pnpm dev",
          }),
        );
        const loaded = yield* loadEnvironmentConfig(input);
        assert.equal(loaded.repoFilePresent, true);
        assert.equal(loaded.resolved.install, "pnpm i");
        assert.equal(loaded.resolved.provenance.install, "repo-file");
        assert.equal(loaded.resolved.start, "pnpm dev");
        assert.equal(loaded.resolved.provenance.start, "saved-env");
      }),
  );

  it.effect(
    "with no repo file and no saved env, the empty provider default resolves to nothing (no-op setup)",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const repoRoot = yield* fs.makeTempDirectoryScoped({ prefix: "kata-loader-test-" });
        const input = {
          repoRoot,
          repositoryIdentity: repoIdentity("github.com/octocat/t3code"),
          savedSandboxEnvironments: {},
        };
        const loaded = yield* loadEnvironmentConfig(input);
        assert.equal(loaded.repoFilePresent, false);
        assert.isUndefined(loaded.resolved.install);
        assert.isUndefined(loaded.resolved.start);
        assert.isUndefined(loaded.resolved.terminals);
        assert.deepEqual(loaded.resolved.provenance, {});
      }),
  );
});
