export const MARKDOWN_IMAGE_MAX_WIDTH = 480;
export const MARKDOWN_IMAGE_MAX_HEIGHT = 480;

export interface MarkdownImageDisplaySize {
  readonly width: number;
  readonly height: number;
}

function isUsablePositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Keeps small images intrinsic while fitting larger images inside the chat viewport. */
export function resolveMarkdownImageDisplaySize(input: {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly availableWidth: number;
}): MarkdownImageDisplaySize | null {
  if (
    !isUsablePositiveFinite(input.sourceWidth) ||
    !isUsablePositiveFinite(input.sourceHeight) ||
    !isUsablePositiveFinite(input.availableWidth)
  ) {
    return null;
  }

  const scale = Math.min(
    1,
    input.availableWidth / input.sourceWidth,
    MARKDOWN_IMAGE_MAX_WIDTH / input.sourceWidth,
    MARKDOWN_IMAGE_MAX_HEIGHT / input.sourceHeight,
  );

  return {
    width: input.sourceWidth * scale,
    height: input.sourceHeight * scale,
  };
}

/**
 * A native onLoad can report unusable dimensions. Treat those as unavailable
 * instead of leaving the thread on a loading frame. availableWidth 0 means
 * layout has not run yet, so a valid source still waits.
 */
export function markdownImageLoadIsUnusable(
  loadedSize: { readonly width: number; readonly height: number } | null,
  availableWidth: number,
): boolean {
  if (loadedSize === null) return false;
  if (!isUsablePositiveFinite(loadedSize.width) || !isUsablePositiveFinite(loadedSize.height)) {
    return true;
  }
  if (availableWidth === 0) return false;
  return (
    resolveMarkdownImageDisplaySize({
      sourceWidth: loadedSize.width,
      sourceHeight: loadedSize.height,
      availableWidth,
    }) === null
  );
}
