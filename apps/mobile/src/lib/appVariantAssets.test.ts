import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(mobileRoot, "../..");

describe("development app variant assets", () => {
  it("uses Kata production brand rasters instead of legacy upstream placeholders", () => {
    const iconPath = resolve(mobileRoot, "assets/icon.png");
    const splashPath = resolve(mobileRoot, "assets/splash-icon.png");
    const brandSourcePath = resolve(repoRoot, "assets/prod/black-ios-1024.png");

    expect(existsSync(iconPath)).toBe(true);
    expect(existsSync(splashPath)).toBe(true);
    expect(existsSync(brandSourcePath)).toBe(true);

    const iconBytes = statSync(iconPath).size;
    const brandBytes = statSync(brandSourcePath).size;

    expect(iconBytes).toBe(brandBytes);
    expect(statSync(splashPath).size).toBe(brandBytes);
  });

  it("keeps the iOS composer icon bundle aligned with Kata logo-mark artwork", () => {
    const logoMarkLayerPath = resolve(
      mobileRoot,
      "assets/icon-composer-prod.icon/Assets/logo-mark-layer.svg",
    );
    const iconJsonPath = resolve(mobileRoot, "assets/icon-composer-prod.icon/icon.json");

    expect(existsSync(logoMarkLayerPath)).toBe(true);
    expect(readFileSync(iconJsonPath, "utf8")).toContain("logo-mark-layer.svg");
  });
});
