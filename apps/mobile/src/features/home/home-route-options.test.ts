import { describe, expect, it } from "vite-plus/test";

import { getHomeRouteHeaderOptions } from "./home-route-options";

describe("getHomeRouteHeaderOptions", () => {
  it("hides the Android native header in split detail", () => {
    expect(
      getHomeRouteHeaderOptions({
        isAndroid: true,
        usesSplitView: true,
        primaryHeaderOptions: { title: "Threads" },
      }),
    ).toEqual({ headerShown: false });
  });

  it("keeps the blank detail options for iOS split navigation", () => {
    const options = getHomeRouteHeaderOptions({
      isAndroid: false,
      usesSplitView: true,
      primaryHeaderOptions: { title: "Threads" },
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
        isAndroid: true,
        usesSplitView: false,
        primaryHeaderOptions,
      }),
    ).toEqual({ ...primaryHeaderOptions, headerShown: true });
  });
});
