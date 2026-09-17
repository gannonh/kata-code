import Constants from "expo-constants";
import { Linking, Platform } from "react-native";

interface AndroidAgentNotifications {
  configure(deviceId: string, userId: string, scheme: string, ongoingEnabled: boolean): void;
  clear(): void;
  openLiveUpdateSettings?(): boolean;
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

export function configureAndroidAgentNotifications(
  deviceId: string,
  userId: string,
  ongoingEnabled: boolean,
): void {
  const scheme = Constants.expoConfig?.scheme;
  nativeLoader()?.configure?.(
    deviceId,
    userId,
    (Array.isArray(scheme) ? scheme[0] : scheme) ?? "katacode",
    ongoingEnabled,
  );
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
