const { withXcodeProject } = require("expo/config-plugins");

const WIDGET_TARGET_NAME = "ExpoWidgetsTarget";

function normalizeBuildSetting(value) {
  return String(value ?? "").replaceAll('"', "");
}

module.exports = function withIosWidgetTargetBuildSettings(config) {
  return withXcodeProject(config, (nextConfig) => {
    const marketingVersion = nextConfig.version ?? "0.1.0";
    const deploymentTarget = nextConfig.ios?.deploymentTarget ?? "18.0";
    const mainBundleId = normalizeBuildSetting(nextConfig.ios?.bundleIdentifier);
    const configurations = nextConfig.modResults.pbxXCBuildConfigurationSection();

    for (const configuration of Object.values(configurations)) {
      const buildSettings = configuration?.buildSettings;
      if (!buildSettings) {
        continue;
      }

      const infoPlist = normalizeBuildSetting(buildSettings.INFOPLIST_FILE);

      if (infoPlist === `${WIDGET_TARGET_NAME}/Info.plist`) {
        buildSettings.MARKETING_VERSION = marketingVersion;
        buildSettings.IPHONEOS_DEPLOYMENT_TARGET = deploymentTarget;
        continue;
      }

      if (!infoPlist.endsWith("/Info.plist") || infoPlist.includes("Pods")) {
        continue;
      }

      const productBundleIdentifier = normalizeBuildSetting(
        buildSettings.PRODUCT_BUNDLE_IDENTIFIER,
      );
      if (mainBundleId.length > 0 && productBundleIdentifier === mainBundleId) {
        buildSettings.MARKETING_VERSION = marketingVersion;
      }
    }

    return nextConfig;
  });
};
