import { SymbolView } from "../../components/AppSymbol";
import { Pressable } from "react-native";

import { useThemeColor } from "../../lib/useThemeColor";

export interface SidebarHeaderActionsProps {
  readonly onOpenSettings: () => void;
}

export function SidebarHeaderActions(props: SidebarHeaderActionsProps) {
  const iconColor = useThemeColor("--color-foreground");

  return (
    <Pressable
      className="size-11 items-center justify-center rounded-full bg-subtle active:opacity-70"
      accessibilityLabel="Open settings"
      accessibilityRole="button"
      hitSlop={4}
      onPress={props.onOpenSettings}
    >
      <SymbolView name="gearshape" size={18} tintColor={iconColor} type="monochrome" />
    </Pressable>
  );
}
