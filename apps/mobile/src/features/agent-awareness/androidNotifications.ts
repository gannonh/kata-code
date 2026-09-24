import Constants from "expo-constants";
import { Linking, Platform } from "react-native";

interface AndroidAgentNotifications {
  configure(deviceId: string, userId: string, scheme: string, ongoingEnabled: boolean): void;
  clear(): void;
  openLiveUpdateSettings?(): boolean;
  showShowcaseActivity?(scheme: string, data: Record<string, string>): void;
}

type NativeLoader = () => AndroidAgentNotifications | null;

function readNativeModule(): AndroidAgentNotifications | null {
  if (Platform.OS !== "android") return null;
  try {
    const expo = require("expo") as {
      requireOptionalNativeModule: <T>(name: string) => T | null;
    };
    return expo.requireOptionalNativeModule<AndroidAgentNotifications>("T3AgentNotifications");
  } catch {
    return null;
  }
}

let nativeLoader: NativeLoader = readNativeModule;

export function supportsAndroidAgentNotifications(): boolean {
  const native = nativeLoader();
  return typeof native?.configure === "function" && typeof native?.clear === "function";
}

function appScheme(): string {
  const scheme = Constants.expoConfig?.scheme;
  return (Array.isArray(scheme) ? scheme[0] : scheme) ?? "katacode";
}

export function configureAndroidAgentNotifications(
  deviceId: string,
  userId: string,
  ongoingEnabled: boolean,
): void {
  nativeLoader()?.configure?.(deviceId, userId, appScheme(), ongoingEnabled);
}

/** Posts a staged relay payload for the showcase capture; false when unsupported. */
export function showAndroidShowcaseAgentActivity(data: Record<string, string>): boolean {
  const native = nativeLoader();
  if (!native?.showShowcaseActivity) return false;
  native.showShowcaseActivity(appScheme(), data);
  return true;
}

export function clearAndroidAgentNotifications(): void {
  nativeLoader()?.clear?.();
}

export function supportsAndroidLiveUpdateSettings(): boolean {
  return Platform.OS === "android" && Number(Platform.Version) >= 36;
}

export async function openAndroidLiveUpdateSettings(): Promise<void> {
  if (!nativeLoader()?.openLiveUpdateSettings?.()) {
    await Linking.openSettings();
  }
}

export function __setAndroidNotificationsNativeLoaderForTest(loader: NativeLoader): void {
  nativeLoader = loader;
}
