#!/usr/bin/env node

import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = join(mobileRoot, ".expo/web/cache/production/images");

for (const directory of ["splash-ios", "iconsuniversal-icon"]) {
  rmSync(join(cacheRoot, directory), { force: true, recursive: true });
}

console.log("Cleared stale Expo splash and icon image caches");
