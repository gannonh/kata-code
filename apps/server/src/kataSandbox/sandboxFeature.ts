import * as Effect from "effect/Effect";

import type { ServerSettings } from "@kata-sh/code-contracts";

import * as ServerConfig from "../config.ts";
import * as ServerSettingsService from "../serverSettings.ts";

export function sandboxesEnabled(
  override: boolean | undefined,
  stored: boolean,
): boolean {
  return override ?? stored;
}

export function applySandboxesOverride<Settings extends { readonly enableSandboxes: boolean }>(
  settings: Settings,
  override: boolean | undefined,
): Settings {
  return override === undefined ? settings : { ...settings, enableSandboxes: override };
}

export const readSandboxesEnabled = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settingsService = yield* ServerSettingsService.ServerSettingsService;
  const settings = yield* settingsService.getSettings.pipe(
    Effect.catch(() => Effect.succeed({ enableSandboxes: false })),
  );
  return sandboxesEnabled(config.sandboxesEnabled, settings.enableSandboxes);
});

export function presentServerSettingsForClient(
  settings: ServerSettings,
  override: boolean | undefined,
): ServerSettings {
  return applySandboxesOverride(
    ServerSettingsService.redactServerSettingsForClient(settings),
    override,
  );
}
