import type { AppNativeStackNavigationOptions } from "../../native/StackHeader";

export function getHomeRouteHeaderOptions(input: {
  readonly isAndroid: boolean;
  readonly usesSplitView: boolean;
  readonly primaryHeaderOptions: AppNativeStackNavigationOptions;
}): AppNativeStackNavigationOptions {
  if (input.usesSplitView) {
    return input.isAndroid
      ? { headerShown: false }
      : { title: "", headerTitle: "", unstable_headerLeftItems: () => [] };
  }

  return { ...input.primaryHeaderOptions, headerShown: true };
}
