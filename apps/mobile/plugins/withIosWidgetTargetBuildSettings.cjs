const { withXcodeProject } = require("expo/config-plugins");

const WIDGET_TARGET_NAME = "ExpoWidgetsTarget";
const APP_TARGET_INFO_PLIST = "KataCodeDev/Info.plist";

module.exports = function withIosWidgetTargetBuildSettings(config) {
  return withXcodeProject(config, (nextConfig) => {
    const marketingVersion = nextConfig.version ?? "0.1.0";
    const deploymentTarget = nextConfig.ios?.deploymentTarget ?? "18.0";
    const configurations = nextConfig.modResults.pbxXCBuildConfigurationSection();

    for (const configuration of Object.values(configurations)) {
      const buildSettings = configuration?.buildSettings;
      if (!buildSettings?.INFOPLIST_FILE) {
        continue;
      }

      if (
        buildSettings.INFOPLIST_FILE === APP_TARGET_INFO_PLIST ||
        buildSettings.INFOPLIST_FILE === `${WIDGET_TARGET_NAME}/Info.plist`
      ) {
        buildSettings.MARKETING_VERSION = marketingVersion;
      }

      if (buildSettings.INFOPLIST_FILE === `${WIDGET_TARGET_NAME}/Info.plist`) {
        buildSettings.IPHONEOS_DEPLOYMENT_TARGET = deploymentTarget;
      }
    }

    return nextConfig;
  });
};
