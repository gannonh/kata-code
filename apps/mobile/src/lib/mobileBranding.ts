import { APP_BASE_NAME, formatAppDisplayName } from "@kata-sh/code-shared/branding";

export type MobileStageLabel = "Alpha" | "Dev" | "Nightly";

export function resolveMobileStageLabel(appVariant: unknown): MobileStageLabel {
  if (appVariant === "development") return "Dev";
  if (appVariant === "preview") return "Nightly";
  return "Alpha";
}

export function resolveMobileDisplayName(appVariant: unknown): string {
  return formatAppDisplayName({
    baseName: APP_BASE_NAME,
    stageLabel: resolveMobileStageLabel(appVariant),
  });
}
