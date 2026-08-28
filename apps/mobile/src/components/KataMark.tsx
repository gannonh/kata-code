import Constants from "expo-constants";
import { Image } from "expo-image";

const appVariant = Constants.expoConfig?.extra?.appVariant;
const KATA_MARK_SOURCE =
  appVariant === "development"
    ? require("../../../../assets/dev/blueprint-ios-1024.png")
    : appVariant === "preview"
      ? require("../../../../assets/nightly/nightly-ios-1024.png")
      : require("../../../../assets/prod/black-ios-1024.png");

export function KataMark(props: { readonly size: number; readonly borderRadius: number }) {
  return (
    <Image
      source={KATA_MARK_SOURCE}
      accessibilityIgnoresInvertColors
      style={{
        width: props.size,
        height: props.size,
        borderRadius: props.borderRadius,
      }}
    />
  );
}
