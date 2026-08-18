import type { DesktopAppBranding } from "@kata-sh/code-contracts";
import {
  APP_BASE_NAME as SHARED_APP_BASE_NAME,
  resolveAppBranding,
} from "@kata-sh/code-shared/branding";

function readInjectedDesktopAppBranding(): DesktopAppBranding | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.desktopBridge?.getAppBranding?.() ?? null;
}

const injectedDesktopAppBranding = readInjectedDesktopAppBranding();
const hostedAppChannel = import.meta.env.VITE_HOSTED_APP_CHANNEL?.trim().toLowerCase();

export const HOSTED_APP_CHANNEL =
  hostedAppChannel === "latest" || hostedAppChannel === "nightly" ? hostedAppChannel : null;

const resolvedBranding = resolveAppBranding({
  isDevelopment: import.meta.env.DEV,
  appVersion: import.meta.env.APP_VERSION || "0.0.0",
  hostedAppChannel: HOSTED_APP_CHANNEL,
});

export const HOSTED_APP_CHANNEL_LABEL = HOSTED_APP_CHANNEL ? resolvedBranding.stageLabel : null;
export const APP_BASE_NAME = injectedDesktopAppBranding?.baseName ?? SHARED_APP_BASE_NAME;
export const APP_STAGE_LABEL =
  injectedDesktopAppBranding?.stageLabel ?? resolvedBranding.stageLabel;
export const APP_DISPLAY_NAME =
  injectedDesktopAppBranding?.displayName ?? resolvedBranding.displayName;
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
