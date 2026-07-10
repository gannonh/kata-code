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
import { createHash } from "node:crypto";
import { mkdir, access, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
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

function expectedSha256(shasumsText, zipName) {
  // Electron ships GNU coreutils-style SHASUMS256.txt lines:
  //   <hex> *<filename>   (binary mode; leading `*` is not part of the name)
  // Also accept text-mode lines without the marker for robustness.
  for (const line of shasumsText.split("\n")) {
    const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(\S+)$/);
    if (match && match[2] === zipName) return match[1].toLowerCase();
  }
  return null;
}

async function verifyElectronZip(zipPath, version) {
  const zipName = basename(zipPath);
  const shasumsUrl = `https://github.com/electron/electron/releases/download/v${version}/SHASUMS256.txt`;
  const shasumsPath = join(zipPath, "..", "SHASUMS256.txt");
  const curl = spawnSync("curl", ["-fsSL", "-o", shasumsPath, shasumsUrl], {
    encoding: "utf8",
  });
  if (curl.status !== 0) {
    throw new Error(`Failed to download Electron SHASUMS256.txt from ${shasumsUrl}`);
  }
  const shasumsText = await readFile(shasumsPath, "utf8");
  const expected = expectedSha256(shasumsText, zipName);
  if (expected === null) {
    throw new Error(`No SHA256 entry for ${zipName} in Electron SHASUMS256.txt`);
  }
  const actual = createHash("sha256")
    .update(await readFile(zipPath))
    .digest("hex");
  if (actual !== expected) {
    throw new Error(
      `Electron zip checksum mismatch for ${zipName}: expected ${expected}, got ${actual}`,
    );
  }
  console.log(`Verified Electron zip checksum: ${zipName}`);
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

  let reused = false;
  try {
    await access(zipPath);
    console.log(`Reusing cached Electron zip: ${zipPath}`);
    reused = true;
  } catch {
    // Not cached — download below.
  }

  if (!reused) {
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

  // Verify integrity for both cache hits and fresh downloads (cache poisoning).
  await verifyElectronZip(zipPath, version);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
