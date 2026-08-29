export const ANDROID_HOME_FAB_SIZE = 56;
export const ANDROID_HOME_FAB_BOTTOM_MARGIN = 16;
export const ANDROID_HOME_FAB_LIST_CLEARANCE = 16;
export const ANDROID_HOME_FAB_MIN_SAFE_BOTTOM_INSET = 16;

export interface AndroidHomeFabLayout {
  readonly fabBottom: number;
  readonly sidebarListBottomPadding: number;
}

/** The sidebar host already consumes the bottom inset, so return residual list padding. */
export function deriveAndroidHomeFabLayout(input: {
  readonly bottomInset: number;
}): AndroidHomeFabLayout {
  const bottomInset = Math.max(0, input.bottomInset);
  const safeBottomInset = Math.max(bottomInset, ANDROID_HOME_FAB_MIN_SAFE_BOTTOM_INSET);
  const fabBottom = safeBottomInset + ANDROID_HOME_FAB_BOTTOM_MARGIN;

  return {
    fabBottom,
    sidebarListBottomPadding:
      fabBottom + ANDROID_HOME_FAB_SIZE + ANDROID_HOME_FAB_LIST_CLEARANCE - bottomInset,
  };
}
