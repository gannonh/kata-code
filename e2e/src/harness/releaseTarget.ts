import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { formatMissingPrerequisiteError } from "./env.ts";

export function resolveReleaseAppBundlePath(): string {
  const configured = process.env.KATACODE_E2E_RELEASE_APP?.trim();
  if (!configured) {
    throw new Error(
      formatMissingPrerequisiteError("desktop-release launch", ["KATACODE_E2E_RELEASE_APP"]) +
        " Set KATACODE_E2E_RELEASE_APP to a built macOS .app bundle, for example /Applications/Kata Code.app.",
    );
  }

  if (!existsSync(configured)) {
    throw new Error(
      `desktop-release launch: release app bundle does not exist at ${configured}. Build or point KATACODE_E2E_RELEASE_APP to a local nightly app.`,
    );
  }

  return configured;
}

export function resolveReleaseExecutablePath(): string {
  const bundlePath = resolveReleaseAppBundlePath();
  const macOsDir = join(bundlePath, "Contents", "MacOS");

  if (!existsSync(macOsDir)) {
    throw new Error(
      `desktop-release launch: expected macOS bundle layout at ${macOsDir}. Supply a .app bundle via KATACODE_E2E_RELEASE_APP.`,
    );
  }

  const executables = readdirSync(macOsDir).filter((entry) => !entry.startsWith("."));
  if (executables.length === 0) {
    throw new Error(
      `desktop-release launch: no executable found under ${macOsDir}. Supply a valid macOS app bundle.`,
    );
  }

  const preferred =
    executables.find((entry) => entry.toLowerCase().includes("kata")) ?? executables[0];
  return join(macOsDir, preferred);
}
