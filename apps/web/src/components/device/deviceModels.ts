import type {
  DeviceAccessorySource,
  DeviceModelSource,
} from "@kata-sh/code-client-runtime/device/model";
import type { DevicePlatform } from "@kata-sh/code-contracts";

// Kata ships no Apple-derived hardware models (no redistribution license), so every
// device, iPhone Duo included, renders the procedural body with no keyboard accessory.
export function deviceModel(_platform: DevicePlatform, _name: string): DeviceModelSource | null {
  return null;
}

export function deviceKeyboard(
  _platform: DevicePlatform,
  _name: string,
): DeviceAccessorySource | null {
  return null;
}
