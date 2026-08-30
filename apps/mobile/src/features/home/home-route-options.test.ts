import { describe, expect, it } from "vite-plus/test";

import { getHomeRouteHeaderOptions } from "./home-route-options";

describe("getHomeRouteHeaderOptions", () => {
  it("hides the Android native header in split detail", () => {
    expect(
      getHomeRouteHeaderOptions({
        kind: "split",
        isAndroid: true,
      }),
    ).toEqual({ headerShown: false });
  });

  it("keeps the blank detail options for iOS split navigation", () => {
    const options = getHomeRouteHeaderOptions({
      kind: "split",
      isAndroid: false,
    });

    expect(options).toMatchObject({ title: "", headerTitle: "" });
    expect(options.unstable_headerLeftItems).toEqual(expect.any(Function));
  });

  it("restores the compact header after leaving split navigation", () => {
    const primaryHeaderOptions = {
      headerShown: false,
      headerTitle: "Kata Code",
      title: "Threads",
    };

    expect(
      getHomeRouteHeaderOptions({
        kind: "compact",
        primaryHeaderOptions,
      }),
    ).toEqual({ ...primaryHeaderOptions, headerShown: true });
  });
});
