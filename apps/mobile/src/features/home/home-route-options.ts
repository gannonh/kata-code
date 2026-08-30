import type { AppNativeStackNavigationOptions } from "../../native/StackHeader";

type HomeRouteHeaderOptionsInput =
  | {
      readonly kind: "split";
      readonly isAndroid: boolean;
    }
  | {
      readonly kind: "compact";
      readonly primaryHeaderOptions: AppNativeStackNavigationOptions;
    };

export function getHomeRouteHeaderOptions(
  input: HomeRouteHeaderOptionsInput,
): AppNativeStackNavigationOptions {
  if (input.kind === "split") {
    return input.isAndroid
      ? { headerShown: false }
      : { title: "", headerTitle: "", unstable_headerLeftItems: () => [] };
  }

  return { ...input.primaryHeaderOptions, headerShown: true };
}
