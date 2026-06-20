export const APP_BASE_NAME = "Kata Code" as const;

export const CLOUD_PRODUCT_NAME = "Kata Code Connect" as const;

/** Pre-rebrand compact display name kept for Application Support folder migration. */
const LEGACY_COMPACT_APP_BASE_NAME = "KataCode" as const;

/** Default user state directory under the home folder (`~/.katacode`). */
export const DEFAULT_HOME_DIR_NAME = ".katacode" as const;

/** Environment variable prefix for runtime configuration (`KATACODE_*`). */
export const ENV_PREFIX = "KATACODE_" as const;

/** Git branch namespace for product-generated refs (worktrees, PR branches). */
export const WORKTREE_BRANCH_PREFIX = "katacode" as const;

/** Hosted web router host (Vercel). */
export const HOSTED_WEB_ROUTER_HOST = "app.kata.sh" as const;

export const DEFAULT_HOSTED_APP_ORIGIN = `https://${HOSTED_WEB_ROUTER_HOST}` as const;

export const HOSTED_WEB_LATEST_ORIGIN = "https://latest.app.kata.sh" as const;

export const HOSTED_WEB_NIGHTLY_ORIGIN = "https://nightly.app.kata.sh" as const;

export const HOSTED_WEB_CHANNEL_PATH = "/__katacode/channel" as const;

export const HOSTED_WEB_CHANNEL_COOKIE = "katacode_web_channel" as const;

const NIGHTLY_VERSION_PATTERN = /-nightly\.\d{8}\.\d+$/u;

export type AppStageLabel = "Dev" | "Alpha" | "Nightly" | "Latest";

export interface AppBranding {
  readonly baseName: typeof APP_BASE_NAME;
  readonly stageLabel: AppStageLabel;
  readonly displayName: string;
}

export const envKey = (suffix: string): string => `${ENV_PREFIX}${suffix}`;

export const resolveDefaultKatacodeHome = (homeDirectory: string): string =>
  `${homeDirectory.replace(/[/\\]+$/, "")}/${DEFAULT_HOME_DIR_NAME}`;

export const isNightlyAppVersion = (version: string): boolean =>
  NIGHTLY_VERSION_PATTERN.test(version.trim());

export const formatAppDisplayName = (stageLabel: string): string =>
  `${APP_BASE_NAME} (${stageLabel})`;

export const formatLegacyCompactAppDisplayName = (stageLabel: string): string =>
  `${LEGACY_COMPACT_APP_BASE_NAME} (${stageLabel})`;

export function resolveAppStageLabel(input: {
  readonly isDevelopment: boolean;
  readonly appVersion: string;
  readonly hostedAppChannel?: "latest" | "nightly" | null;
}): AppStageLabel {
  if (input.hostedAppChannel === "nightly") {
    return "Nightly";
  }
  if (input.hostedAppChannel === "latest") {
    return "Latest";
  }
  if (input.isDevelopment) {
    return "Dev";
  }
  return isNightlyAppVersion(input.appVersion) ? "Nightly" : "Alpha";
}

export function resolveAppBranding(input: {
  readonly isDevelopment: boolean;
  readonly appVersion: string;
  readonly hostedAppChannel?: "latest" | "nightly" | null;
}): AppBranding {
  const stageLabel = resolveAppStageLabel(input);
  return {
    baseName: APP_BASE_NAME,
    stageLabel,
    displayName: formatAppDisplayName(stageLabel),
  };
}

/** Pre-rebrand Electron userData folder names to probe (`KataCode` compact name). */
export function resolveLegacyUserDataDirNames(input: {
  readonly isDevelopment: boolean;
  readonly appVersion: string;
}): readonly string[] {
  const stageLabel = resolveAppStageLabel({
    isDevelopment: input.isDevelopment,
    appVersion: input.appVersion,
  });
  return [formatAppDisplayName(stageLabel), formatLegacyCompactAppDisplayName(stageLabel)];
}
