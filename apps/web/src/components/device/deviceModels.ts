import type {
  DeviceAccessorySource,
  DeviceModelSource,
} from "@kata-sh/code-client-runtime/device/model";
import type { DevicePlatform } from "@kata-sh/code-contracts";

// Kata bundles no hardware models. Upstream's converted Apple device models have
// no established redistribution license, so every device renders the procedural
// body and no keyboard accessory is offered (KAT-3454).
export function deviceModel(_platform: DevicePlatform, _name: string): DeviceModelSource | null {
  return null;
}

export function deviceKeyboard(
  _platform: DevicePlatform,
  _name: string,
): DeviceAccessorySource | null {
  return null;
}
