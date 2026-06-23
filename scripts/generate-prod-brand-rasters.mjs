#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const desktopResourcesDir = join(repoRoot, "apps/desktop/resources");
const sourcePng = join(desktopResourcesDir, "source.png");
const sourceSvg = join(desktopResourcesDir, "icon.svg");
const iconComposerMarkLayerSvg = join(desktopResourcesDir, "logo-mark-layer.svg");
const prodDir = join(repoRoot, "assets/prod");
const webPublicDir = join(repoRoot, "apps/web/public");
const mobileAssetsDir = join(repoRoot, "apps/mobile/assets");

function sips(...args) {
  execFileSync("sips", args, { stdio: "inherit" });
}

function magick(...args) {
  execFileSync("magick", args, { stdio: "inherit" });
}

mkdirSync(prodDir, { recursive: true });

for (const [name, size] of [
  ["black-macos-1024.png", 1024],
  ["black-ios-1024.png", 1024],
  ["black-universal-1024.png", 1024],
  ["katacode-web-apple-touch-180.png", 180],
  ["katacode-web-favicon-32x32.png", 32],
  ["katacode-web-favicon-16x16.png", 16],
]) {
  sips("-z", String(size), String(size), sourcePng, "--out", join(prodDir, name));
}

for (const [name, sizes] of [
  ["katacode-web-favicon.ico", "256,128,64,48,32,16"],
  ["katacode-windows.ico", "256,128,64,48,32,16"],
]) {
  magick(sourcePng, "-define", `icon:auto-resize=${sizes}`, join(prodDir, name));
}

copyFileSync(sourceSvg, join(prodDir, "logo.svg"));

mkdirSync(webPublicDir, { recursive: true });
copyFileSync(join(prodDir, "katacode-web-favicon.ico"), join(webPublicDir, "favicon.ico"));
copyFileSync(
  join(prodDir, "katacode-web-favicon-16x16.png"),
  join(webPublicDir, "favicon-16x16.png"),
);
copyFileSync(
  join(prodDir, "katacode-web-favicon-32x32.png"),
  join(webPublicDir, "favicon-32x32.png"),
);
copyFileSync(
  join(prodDir, "katacode-web-apple-touch-180.png"),
  join(webPublicDir, "apple-touch-icon.png"),
);
copyFileSync(sourceSvg, join(webPublicDir, "logo-mark.svg"));

mkdirSync(mobileAssetsDir, { recursive: true });
copyFileSync(join(prodDir, "black-ios-1024.png"), join(mobileAssetsDir, "icon.png"));
copyFileSync(join(prodDir, "black-ios-1024.png"), join(mobileAssetsDir, "splash-icon.png"));
sips(
  "-z",
  "1024",
  "1024",
  sourcePng,
  "--out",
  join(mobileAssetsDir, "android-icon-foreground.png"),
);
copyFileSync(
  join(mobileAssetsDir, "android-icon-foreground.png"),
  join(mobileAssetsDir, "android-icon-monochrome.png"),
);
sips(
  "-z",
  "1024",
  "1024",
  sourcePng,
  "--out",
  join(mobileAssetsDir, "android-icon-background.png"),
);
sips("-z", "180", "180", sourcePng, "--out", join(mobileAssetsDir, "favicon.png"));
for (const iconBundle of ["icon-composer-prod.icon", "icon-composer-dev.icon"]) {
  copyFileSync(
    iconComposerMarkLayerSvg,
    join(mobileAssetsDir, iconBundle, "Assets/logo-mark-layer.svg"),
  );
}

execFileSync(join(desktopResourcesDir, "generate-icons.sh"), [sourcePng], {
  cwd: desktopResourcesDir,
  stdio: "inherit",
});

console.log("Generated production brand rasters from", sourcePng);
console.log(
  "Synced apps/web/public, apps/mobile/assets, and refreshed apps/desktop/resources platform icons",
);
