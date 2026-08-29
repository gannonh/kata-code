import { describe, expect, it } from "vite-plus/test";

import { deriveAndroidHomeFabLayout } from "./android-home-fab-layout";

describe("deriveAndroidHomeFabLayout", () => {
  it("keeps the final sidebar row clear of the FAB without a bottom inset", () => {
    expect(deriveAndroidHomeFabLayout({ bottomInset: 0 })).toEqual({
      fabBottom: 32,
      compactListBottomPadding: 104,
      sidebarListBottomPadding: 104,
    });
  });

  it("subtracts the sidebar safe-area wrapper from its residual list padding", () => {
    const layout = deriveAndroidHomeFabLayout({ bottomInset: 24 });

    expect(layout).toEqual({
      fabBottom: 40,
      compactListBottomPadding: 112,
      sidebarListBottomPadding: 88,
    });
  });
});
