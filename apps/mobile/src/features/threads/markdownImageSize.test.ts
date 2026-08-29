import { describe, expect, it } from "vite-plus/test";

import {
  MARKDOWN_IMAGE_MAX_HEIGHT,
  MARKDOWN_IMAGE_MAX_WIDTH,
  markdownImageLoadIsUnusable,
  resolveMarkdownImageDisplaySize,
} from "./markdownImageSize";

describe("resolveMarkdownImageDisplaySize", () => {
  it("keeps small images at their intrinsic size", () => {
    expect(
      resolveMarkdownImageDisplaySize({
        sourceWidth: 96,
        sourceHeight: 96,
        availableWidth: 332,
      }),
    ).toEqual({ width: 96, height: 96 });
  });

  it("fits wide images to the available chat width", () => {
    expect(
      resolveMarkdownImageDisplaySize({
        sourceWidth: 960,
        sourceHeight: 540,
        availableWidth: 332,
      }),
    ).toEqual({ width: 332, height: 186.75 });
  });

  it("caps wide images at 480 points on larger screens", () => {
    expect(
      resolveMarkdownImageDisplaySize({
        sourceWidth: 960,
        sourceHeight: 540,
        availableWidth: 900,
      }),
    ).toEqual({ width: MARKDOWN_IMAGE_MAX_WIDTH, height: 270 });
  });

  it("caps tall images by height without changing their aspect ratio", () => {
    expect(
      resolveMarkdownImageDisplaySize({
        sourceWidth: 400,
        sourceHeight: 800,
        availableWidth: 332,
      }),
    ).toEqual({ width: 240, height: MARKDOWN_IMAGE_MAX_HEIGHT });
  });

  it.each([
    ["zero width", { sourceWidth: 0, sourceHeight: 100, availableWidth: 332 }],
    ["zero height", { sourceWidth: 100, sourceHeight: 0, availableWidth: 332 }],
    ["negative width", { sourceWidth: -12, sourceHeight: 100, availableWidth: 332 }],
    ["negative height", { sourceWidth: 100, sourceHeight: -8, availableWidth: 332 }],
    ["NaN width", { sourceWidth: Number.NaN, sourceHeight: 100, availableWidth: 332 }],
    ["NaN height", { sourceWidth: 100, sourceHeight: Number.NaN, availableWidth: 332 }],
    [
      "Infinity width",
      { sourceWidth: Number.POSITIVE_INFINITY, sourceHeight: 100, availableWidth: 332 },
    ],
    [
      "Infinity height",
      { sourceWidth: 100, sourceHeight: Number.POSITIVE_INFINITY, availableWidth: 332 },
    ],
    ["NaN availableWidth", { sourceWidth: 100, sourceHeight: 100, availableWidth: Number.NaN }],
    [
      "Infinity availableWidth",
      { sourceWidth: 100, sourceHeight: 100, availableWidth: Number.POSITIVE_INFINITY },
    ],
    ["negative availableWidth", { sourceWidth: 100, sourceHeight: 100, availableWidth: -40 }],
  ])("rejects %s", (_label, input) => {
    expect(resolveMarkdownImageDisplaySize(input)).toBeNull();
  });
});

describe("markdownImageLoadIsUnusable", () => {
  it("waits for layout when a valid source has not been measured yet", () => {
    expect(markdownImageLoadIsUnusable({ width: 96, height: 96 }, 0)).toBe(false);
    expect(markdownImageLoadIsUnusable(null, 332)).toBe(false);
  });

  it.each([
    ["zero", { width: 0, height: 100 }],
    ["negative", { width: 100, height: -4 }],
    ["NaN", { width: Number.NaN, height: 100 }],
    ["Infinity", { width: Number.POSITIVE_INFINITY, height: 80 }],
  ])("settles %s loaded dimensions to unavailable even before layout", (_label, loadedSize) => {
    expect(markdownImageLoadIsUnusable(loadedSize, 0)).toBe(true);
    expect(
      resolveMarkdownImageDisplaySize({
        sourceWidth: loadedSize.width,
        sourceHeight: loadedSize.height,
        availableWidth: 332,
      }),
    ).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "settles a valid source to unavailable when availableWidth is %s",
    (availableWidth) => {
      expect(markdownImageLoadIsUnusable({ width: 96, height: 96 }, availableWidth)).toBe(true);
      expect(
        resolveMarkdownImageDisplaySize({
          sourceWidth: 96,
          sourceHeight: 96,
          availableWidth,
        }),
      ).toBeNull();
    },
  );
});
