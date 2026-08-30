import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  CodexSettings,
  ProviderInstanceId,
  type ModelSelection,
  type ServerSettings as ServerSettingsValue,
  type ProviderInstanceConfig,
} from "@kata-sh/code-contracts";

import * as ServerSettings from "../serverSettings.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";

export class SandboxCredentialUnavailableError extends Data.TaggedError(
  "SandboxCredentialUnavailableError",
)<{
  readonly providerInstanceId: ProviderInstanceId;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface SandboxCredentialSeedShape {
  readonly resolve: (
    providerInstanceId: ProviderInstanceId,
  ) => Effect.Effect<SandboxCredentialSeedValue, SandboxCredentialUnavailableError>;
}

export interface SandboxCredentialSeedValue {
  readonly authJson: Uint8Array;
  readonly modelSelection: ModelSelection;
}

export class SandboxCredentialSeed extends Context.Service<
  SandboxCredentialSeed,
  SandboxCredentialSeedShape
>()("@kata-sh/code-cli/kataSandbox/SandboxCredentialSeed") {}

const decodeCodexSettings = Schema.decodeUnknownEffect(CodexSettings);

function configForInstance(
  settings: ServerSettingsValue,
  providerInstanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstanceConfig | CodexSettings, SandboxCredentialUnavailableError> {
  const configured = settings.providerInstances[providerInstanceId];
  if (configured !== undefined) return Effect.succeed(configured);
  if (providerInstanceId === "codex") return Effect.succeed(settings.providers.codex);
  return Effect.fail(
    new SandboxCredentialUnavailableError({
      providerInstanceId,
      message: "The selected provider instance is not configured.",
    }),
  );
}

const makeSeed = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const resolve: SandboxCredentialSeedShape["resolve"] = Effect.fn("kataSandbox.resolveCodexAuth")(
    function* (providerInstanceId) {
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new SandboxCredentialUnavailableError({
              providerInstanceId,
              message: "Server settings could not be read.",
              cause,
            }),
        ),
      );
      const rawConfig = yield* configForInstance(settings, providerInstanceId);
      if ("driver" in rawConfig && rawConfig.driver !== "codex") {
        return yield* new SandboxCredentialUnavailableError({
          providerInstanceId,
          message: "The selected provider instance is not a Codex instance.",
        });
      }
      const codexConfig = yield* decodeCodexSettings(
        "driver" in rawConfig ? (rawConfig.config ?? {}) : rawConfig,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new SandboxCredentialUnavailableError({
              providerInstanceId,
              message: "The selected provider instance has invalid Codex settings.",
              cause,
            }),
        ),
      );
      if ("enabled" in rawConfig && rawConfig.enabled === false) {
        return yield* new SandboxCredentialUnavailableError({
          providerInstanceId,
          message: "The selected Codex instance is disabled.",
        });
      }

      const layout = yield* resolveCodexHomeLayout(codexConfig).pipe(
        Effect.provideService(Path.Path, path),
      );
      const home = layout.effectiveHomePath ?? layout.sharedHomePath;
      const authPath = path.join(home, "auth.json");
      const authJson = yield* fileSystem.readFile(authPath).pipe(
        Effect.mapError(
          (cause) =>
            new SandboxCredentialUnavailableError({
              providerInstanceId,
              message: "The selected Codex auth.json is unavailable.",
              cause,
            }),
        ),
      );
      return {
        authJson,
        modelSelection: {
          ...settings.textGenerationModelSelection,
          instanceId: providerInstanceId,
        },
      } satisfies SandboxCredentialSeedValue;
    },
  );

  return SandboxCredentialSeed.of({ resolve });
});

export const layer = Layer.effect(SandboxCredentialSeed, makeSeed);
