import { describe, expect, it } from "vite-plus/test";

import { resolveWebAssetBrandForPackageVersion } from "./brand-assets.ts";

describe("preview brand assets", () => {
  it("maps preview package versions to production assets", () => {
    expect(resolveWebAssetBrandForPackageVersion("0.0.29-preview.20260723.882")).toBe("production");
  });
});
