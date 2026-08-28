import Constants from "expo-constants";
import { View } from "react-native";

import { AppText as Text } from "./AppText";
import { KataMark } from "./KataMark";
import { resolveMobileStageLabel } from "../lib/mobileBranding";

export function BrandMark(props: { readonly compact?: boolean }) {
  const compact = props.compact ?? false;
  const iconSize = compact ? 32 : 44;
  const stageLabel = resolveMobileStageLabel(Constants.expoConfig?.extra?.appVariant);

  return (
    <View className="flex-row items-center gap-3">
      <KataMark borderRadius={compact ? 10 : 14} size={iconSize} />
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-lg font-t3-bold tracking-[-0.4px] text-foreground">Kata Code</Text>
          <View className="rounded-full bg-subtle px-2 py-1">
            <Text className="text-3xs font-t3-bold tracking-[1.1px] uppercase text-foreground-muted">
              {stageLabel}
            </Text>
          </View>
        </View>
        {!compact ? (
          <Text className="text-xs font-medium text-foreground-muted">
            Mobile control surface for your live coding environments
          </Text>
        ) : null}
      </View>
    </View>
  );
}
