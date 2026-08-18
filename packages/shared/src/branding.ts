export const APP_BASE_NAME = "Kata Code" as const;

/** Compact product abbreviation for space-constrained surfaces. */
export const PRODUCT_ABBREVIATION = "KC" as const;

export const CLOUD_PRODUCT_NAME = "Kata Code Connect" as const;

/** Default user state directory under the home folder (`~/.katacode`). */
export const DEFAULT_HOME_DIR_NAME = ".katacode" as const;

/** Environment variable prefix for runtime configuration (`KATACODE_*`). */
export const ENV_PREFIX = "KATACODE_" as const;

/** Git branch namespace for product-generated refs (worktrees, PR branches). */
export const WORKTREE_BRANCH_PREFIX = "katacode" as const;

/** Desktop / mobile URL schemes. */
export const PROTOCOL_SCHEME = "katacode" as const;
export const PROTOCOL_SCHEME_DEV = "katacode-dev" as const;
export const PROTOCOL_SCHEME_PREVIEW = "katacode-preview" as const;

/** Production desktop / mobile bundle id. */
export const DESKTOP_BUNDLE_ID = "com.katacode.app" as const;

/** Dev desktop bundle id prefix; suffix is the repo folder name. */
export const DESKTOP_BUNDLE_ID_DEV_PREFIX = "com.katacode.dev" as const;

/** Hosted web router host (Vercel). */
export const HOSTED_WEB_ROUTER_HOST = "app.kata.sh" as const;

export const DEFAULT_HOSTED_APP_ORIGIN = `https://${HOSTED_WEB_ROUTER_HOST}` as const;

export const HOSTED_WEB_LATEST_ORIGIN = "https://latest.app.kata.sh" as const;

export const HOSTED_WEB_NIGHTLY_ORIGIN = "https://nightly.app.kata.sh" as const;

export const HOSTED_WEB_CHANNEL_PATH = "/__katacode/channel" as const;

export const HOSTED_WEB_CHANNEL_COOKIE = "katacode_web_channel" as const;

const NIGHTLY_SERVER_VERSION_PATTERN = /-nightly\.\d{8}\.\d+$/;

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
  NIGHTLY_SERVER_VERSION_PATTERN.test(version.trim());

export function formatAppDisplayName(input: {
  readonly baseName: string;
  readonly stageLabel: string;
}): string {
  if (input.stageLabel.trim().toLowerCase() === "latest") {
    return input.baseName;
  }

  return `${input.baseName} (${input.stageLabel})`;
}

export function resolveServerBackedAppStageLabel(input: {
  readonly primaryServerVersion: string | null | undefined;
  readonly fallbackStageLabel: string;
}): string {
  return input.primaryServerVersion &&
    NIGHTLY_SERVER_VERSION_PATTERN.test(input.primaryServerVersion)
    ? "Nightly"
    : input.fallbackStageLabel;
}

export function resolveServerBackedAppDisplayName(input: {
  readonly baseName: string;
  readonly fallbackDisplayName: string;
  readonly fallbackStageLabel: string;
  readonly primaryServerVersion: string | null | undefined;
}): string {
  const stageLabel = resolveServerBackedAppStageLabel({
    primaryServerVersion: input.primaryServerVersion,
    fallbackStageLabel: input.fallbackStageLabel,
  });

  return stageLabel === input.fallbackStageLabel
    ? input.fallbackDisplayName
    : formatAppDisplayName({ baseName: input.baseName, stageLabel });
}

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
    displayName: formatAppDisplayName({ baseName: APP_BASE_NAME, stageLabel }),
  };
}
