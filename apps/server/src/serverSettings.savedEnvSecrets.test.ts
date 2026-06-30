import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  type SavedSandboxEnvironment,
  RepositoryCanonicalKey,
} from "@kata-sh/code-contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ServerConfig } from "./config.ts";
import {
  redactServerSettingsForClient,
  ServerSettingsLive,
  ServerSettingsService,
} from "./serverSettings.ts";

const makeServerSettingsLayer = () =>
  ServerSettingsLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "katacode-saved-env-secrets-test-",
        }),
      ),
    ),
  );

it.layer(NodeServices.layer)("ServerSettings.savedSandboxEnvironments secrets", (it) => {
  const repoKey = RepositoryCanonicalKey.make("github.com/owner/repo");

  it.effect(
    "stores a sensitive saved-env value outside settings.json and materializes it on read (AC-2.5)",
    () =>
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsService;
        const serverConfig = yield* ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;

        const next = yield* serverSettings.updateSettings({
          savedSandboxEnvironments: {
            [repoKey]: {
              install: "pnpm i",
              environment: [
                { name: "DEPLOY_TOKEN", value: "super-secret-token", sensitive: true },
                { name: "LOG_LEVEL", value: "debug", sensitive: false },
              ],
            },
          },
        });

        // The returned (materialized) settings carry the real secret value
        // and mark it redacted, mirroring the provider/sandbox instance path.
        const saved = next.savedSandboxEnvironments[repoKey] as SavedSandboxEnvironment | undefined;
        assert.isDefined(saved);
        assert.deepEqual(saved?.environment, [
          {
            name: "DEPLOY_TOKEN",
            value: "super-secret-token",
            sensitive: true,
            valueRedacted: true,
          },
          { name: "LOG_LEVEL", value: "debug", sensitive: false },
        ]);

        // The persisted settings.json never contains the secret plaintext.
        const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
        assert.notInclude(raw, "super-secret-token");
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        const persisted = JSON.parse(raw).savedSandboxEnvironments[repoKey as string];
        assert.deepEqual(persisted.environment, [
          { name: "DEPLOY_TOKEN", value: "", sensitive: true, valueRedacted: true },
          { name: "LOG_LEVEL", value: "debug", sensitive: false },
        ]);

        // A subsequent update carrying the redacted form (value: "",
        // valueRedacted: true) re-materializes the secret from the store.
        const roundTripped = yield* serverSettings.updateSettings({
          savedSandboxEnvironments: {
            [repoKey]: {
              install: "pnpm i",
              environment: [
                { name: "DEPLOY_TOKEN", value: "", sensitive: true, valueRedacted: true },
                { name: "LOG_LEVEL", value: "debug", sensitive: false },
              ],
            },
          },
        });

        const roundTrippedSaved = roundTripped.savedSandboxEnvironments[repoKey] as
          | SavedSandboxEnvironment
          | undefined;
        assert.equal(roundTrippedSaved?.environment?.[0]?.value, "super-secret-token");
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("redacts saved-env secrets for the client (AC-2.4)", () =>
    Effect.gen(function* () {
      const redacted = redactServerSettingsForClient({
        ...DEFAULT_SERVER_SETTINGS,
        savedSandboxEnvironments: {
          [repoKey]: {
            environment: [
              { name: "DEPLOY_TOKEN", value: "super-secret-token", sensitive: true },
              { name: "LOG_LEVEL", value: "debug", sensitive: false, valueRedacted: true },
            ],
          },
        },
      });

      const saved = redacted.savedSandboxEnvironments[repoKey] as
        | SavedSandboxEnvironment
        | undefined;
      assert.deepEqual(saved?.environment, [
        { name: "DEPLOY_TOKEN", value: "", sensitive: true, valueRedacted: true },
        { name: "LOG_LEVEL", value: "debug", sensitive: false },
      ]);
    }),
  );

  it.effect("removes a saved-env secret when its sensitive entry is dropped (AC-2.5)", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      // Seed a sensitive entry.
      yield* serverSettings.updateSettings({
        savedSandboxEnvironments: {
          [repoKey]: {
            environment: [{ name: "DEPLOY_TOKEN", value: "to-be-removed", sensitive: true }],
          },
        },
      });

      // Replace the saved env with no environment at all — the stale secret
      // must be removed from the store so it does not leak across re-edits.
      yield* serverSettings.updateSettings({
        savedSandboxEnvironments: {
          [repoKey]: {
            install: "pnpm i",
          },
        },
      });

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.notInclude(raw, "to-be-removed");
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const persisted = JSON.parse(raw).savedSandboxEnvironments[repoKey as string];
      assert.isUndefined(persisted.environment);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});
