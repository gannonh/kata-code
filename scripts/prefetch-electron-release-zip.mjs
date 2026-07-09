#!/usr/bin/env node
/**
 * Prefetch (or resolve) the Electron release zip for a platform/arch matrix cell.
 *
 * Used by `.github/workflows/release.yml` so the workflow stays thin and the
 * zip naming/URL logic lives in `scripts/build-desktop-artifact.ts`.
 *
 * Usage:
 *   node scripts/prefetch-electron-release-zip.mjs --print-name
 *   node scripts/prefetch-electron-release-zip.mjs --download
 *
 * Env:
 *   ELECTRON_VERSION, MATRIX_PLATFORM, MATRIX_ARCH
 *   ELECTRON_CACHE_DIR (required for --download)
 *   ELECTRON_ZIP_NAME (optional for --download; derived when omitted)
 */
import { createRequire } from "node:module";
import { mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

async function loadHelpers() {
  // Dynamic import of the TS module via Node's experimental type stripping /
  // the repo's usual `node --input-type=module` path. Prefer the compiled
  // helpers exported from build-desktop-artifact.ts.
  const mod = await import("./build-desktop-artifact.ts");
  return {
    electronReleaseZipName: mod.electronReleaseZipName,
    electronReleaseZipUrl: mod.electronReleaseZipUrl,
  };
}

function readArgs(argv) {
  return {
    printName: argv.includes("--print-name"),
    download: argv.includes("--download"),
  };
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main() {
  const { printName, download } = readArgs(process.argv.slice(2));
  if (!printName && !download) {
    throw new Error("Pass --print-name and/or --download");
  }

  const version =
    process.env.ELECTRON_VERSION?.trim() ||
    require("../apps/desktop/package.json").dependencies.electron;
  const platform = requireEnv("MATRIX_PLATFORM");
  const arch = requireEnv("MATRIX_ARCH");

  const { electronReleaseZipName, electronReleaseZipUrl } = await loadHelpers();
  const zipName = electronReleaseZipName({ version, platform, arch });

  if (printName) {
    process.stdout.write(`${zipName}\n`);
  }

  if (!download) return;

  const cacheDir = requireEnv("ELECTRON_CACHE_DIR");
  await mkdir(cacheDir, { recursive: true });
  const zipPath = join(cacheDir, process.env.ELECTRON_ZIP_NAME?.trim() || zipName);

  try {
    await access(zipPath);
    console.log(`Reusing cached Electron zip: ${zipPath}`);
    return;
  } catch {
    // Not cached — download below.
  }

  const url = electronReleaseZipUrl({ version, platform, arch });
  console.log(`Downloading ${url}`);
  const result = spawnSync(
    "curl",
    [
      "-fsSL",
      "--retry",
      "8",
      "--retry-all-errors",
      "--retry-delay",
      "2",
      "--connect-timeout",
      "30",
      "-o",
      zipPath,
      url,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  spawnSync("ls", ["-lh", zipPath], { stdio: "inherit" });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
