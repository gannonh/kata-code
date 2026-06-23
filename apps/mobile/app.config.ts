import type { ExpoConfig } from "expo/config";

import { loadRepoEnv } from "../../scripts/lib/public-config.ts";

type AppVariant = "development" | "preview" | "production";

const repoEnv = loadRepoEnv();
Object.assign(process.env, repoEnv);

const APP_VARIANT = resolveAppVariant(repoEnv.APP_VARIANT);

const VARIANT_CONFIG: Record<
  AppVariant,
  {
    readonly appName: string;
    readonly scheme: string;
    readonly iosBundleIdentifier: string;
    readonly androidPackage: string;
  }
> = {
  development: {
    appName: "Kata Code Dev",
    scheme: "katacode-dev",
    iosBundleIdentifier: "com.katacode.dev",
    androidPackage: "com.katacode.dev",
  },
  preview: {
    appName: "Kata Code Preview",
    scheme: "katacode-preview",
    iosBundleIdentifier: "com.katacode.preview",
    androidPackage: "com.katacode.preview",
  },
  production: {
    appName: "Kata Code",
    scheme: "katacode",
    iosBundleIdentifier: "com.katacode.app",
    androidPackage: "com.katacode.app",
  },
};

function resolveAppVariant(value: string | undefined): AppVariant {
  switch (value) {
    case "development":
    case "preview":
    case "production":
      return value;
    default:
      return "production";
  }
}

const variant = VARIANT_CONFIG[APP_VARIANT];
const easProjectId = repoEnv.KATACODE_EAS_PROJECT_ID?.trim() || undefined;
const iosHomeScreenIcon = "./assets/icon-composer-prod.icon";

const devClientPlugin: [string, Record<string, unknown>] = [
  "expo-dev-client",
  APP_VARIANT === "development"
    ? {
        toolsButton: false,
        showMenuAtLaunch: false,
      }
    : {},
];

const config: ExpoConfig = {
  name: variant.appName,
  slug: "katacode",
  platforms: ["ios", "android"],
  scheme: variant.scheme,
  version: "0.1.0",
  runtimeVersion: {
    policy: process.env.MOBILE_VERSION_POLICY ?? "appVersion",
  },
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  updates: easProjectId
    ? {
        enabled: true,
        url: `https://u.expo.dev/${easProjectId}`,
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
      }
    : {
        enabled: false,
      },
  ios: {
    icon: iosHomeScreenIcon,
    deploymentTarget: "18.0",
    supportsTablet: true,
    bundleIdentifier: variant.iosBundleIdentifier,
    infoPlist: {
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
      },
      NSLocalNetworkUsageDescription:
        "Allow Kata Code to connect to Kata Code servers on your local network or tailnet.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    icon: "./assets/icon.png",
    package: variant.androidPackage,
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: [
    devClientPlugin,
    "expo-router",
    "expo-font",
    "expo-secure-store",
    ["@clerk/expo", { theme: "./clerk-theme.json" }],
    "expo-web-browser",
    [
      "expo-camera",
      {
        cameraPermission: "Allow Kata Code to access your camera so you can scan pairing QR codes.",
        barcodeScannerEnabled: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        imageWidth: 220,
        dark: {
          image: "./assets/splash-icon.png",
          backgroundColor: "#0a0a0a",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        ios: {
          deploymentTarget: "18.0",
        },
      },
    ],
    [
      "expo-widgets",
      {
        bundleIdentifier: `${variant.iosBundleIdentifier}.widgets`,
        groupIdentifier: `group.${variant.iosBundleIdentifier}`,
        enablePushNotifications: true,
        widgets: [
          {
            name: "AgentActivity",
            displayName: "Agent Activity",
            description: "Shows the current state of active Kata Code agents.",
            supportedFamilies: ["systemSmall", "systemMedium", "accessoryRectangular"],
          },
        ],
      },
    ],
    "./plugins/withIosWidgetTargetBuildSettings.cjs",
    "./plugins/withAndroidCleartextTraffic.cjs",
  ],
  extra: {
    appVariant: APP_VARIANT,
    relay: {
      url: repoEnv.KATACODE_RELAY_URL ?? null,
    },
    clerk: {
      publishableKey: repoEnv.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null,
      jwtTemplate: repoEnv.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ?? null,
    },
    observability: {
      tracesUrl: repoEnv.EXPO_PUBLIC_OTLP_TRACES_URL ?? "https://api.axiom.co/v1/traces",
      tracesDataset: repoEnv.EXPO_PUBLIC_OTLP_TRACES_DATASET ?? null,
      tracesToken: repoEnv.EXPO_PUBLIC_OTLP_TRACES_TOKEN ?? null,
    },
    eas: easProjectId ? { projectId: easProjectId } : undefined,
  },
  owner: repoEnv.EXPO_OWNER?.trim() || "gannonh",
};

export default config;
