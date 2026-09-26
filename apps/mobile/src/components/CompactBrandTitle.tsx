import Constants from "expo-constants";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { Platform, View } from "react-native";

import { AppText as Text } from "./AppText";
import { KataMark } from "./KataMark";
import { IPAD_HOME_TITLE_OFFSET } from "../lib/layoutMetrics";
import { resolveMobileStageLabel } from "../lib/mobileBranding";
import { useAndroidControlSizing } from "./useAndroidControlSizing";

/**
 * Horizontal correction applied to content rendered in the brand title slot,
 * shared with the connection-status swap so both align identically.
 */
export function brandTitleOffset(): number {
  if (Platform.OS !== "ios") return 0;
  return Platform.isPad ? IPAD_HOME_TITLE_OFFSET : 0;
}

/**
 * Compact brand lockup sized for native navigation bars.
 */
export function CompactBrandTitle(
  props: {
    readonly allowFontScaling?: boolean;
  } = {},
) {
  const stageLabel = resolveMobileStageLabel(Constants.expoConfig?.extra?.appVariant);
  const titleOffset = brandTitleOffset();
  const { scale } = useAndroidControlSizing();

  return (
    <View
      aria-level={1}
      accessibilityLabel="Kata Code, Threads"
      accessible
      role="heading"
      style={{
        alignItems: "center",
        flexDirection: "row",
        flexShrink: 1,
        gap: Platform.OS === "android" ? 5.25 * scale : 6,
        marginLeft: titleOffset,
        minWidth: 0,
      }}
    >
      <KataMark borderRadius={Math.round(6 * scale)} size={Math.round(20 * scale)} />
      <Text
        allowFontScaling={props.allowFontScaling}
        className="text-foreground-muted"
        ellipsizeMode="tail"
        numberOfLines={1}
        style={{
          flexShrink: 1,
          fontFamily: "DMSans-Medium",
          fontSize: 21 * scale,
          letterSpacing: -0.5 * scale,
          minWidth: 0,
        }}
      >
        Kata Code
      </Text>
      <View
        className="bg-subtle"
        style={{
          borderRadius: 999,
          flexShrink: 0,
          paddingHorizontal: Platform.OS === "android" ? 5.25 * scale : 6,
          paddingVertical: Platform.OS === "android" ? 1.75 * scale : 2,
        }}
      >
        <Text
          allowFontScaling={props.allowFontScaling}
          className="font-t3-bold text-foreground-muted uppercase"
          style={{ fontSize: 9 * scale, letterSpacing: 0.9 * scale }}
        >
          {stageLabel}
        </Text>
      </View>
    </View>
  );
}

export function renderCompactBrandTitle() {
  return <CompactBrandTitle allowFontScaling={Platform.OS === "ios"} />;
}

export function getCompactBrandHeaderOptions(
  fallbackTitleStyle?: NativeStackNavigationOptions["headerTitleStyle"],
): NativeStackNavigationOptions {
  return {
    headerTitle: renderCompactBrandTitle,
    headerTitleStyle: fallbackTitleStyle,
    title: "Threads",
    unstable_headerLeftItems: undefined,
  };
}
