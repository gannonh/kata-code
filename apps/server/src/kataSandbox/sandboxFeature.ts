import type { ServerSettings } from "@kata-sh/code-contracts";

import * as ServerSettingsService from "../serverSettings.ts";

export function sandboxesEnabled(override: boolean | undefined, stored: boolean): boolean {
  return override ?? stored;
}

export function applySandboxesOverride<Settings extends { readonly enableSandboxes: boolean }>(
  settings: Settings,
  override: boolean | undefined,
): Settings {
  return override === undefined ? settings : { ...settings, enableSandboxes: override };
}

export function presentServerSettingsForClient(
  settings: ServerSettings,
  override: boolean | undefined,
): ServerSettings {
  return applySandboxesOverride(
    ServerSettingsService.redactServerSettingsForClient(settings),
    override,
  );
}
