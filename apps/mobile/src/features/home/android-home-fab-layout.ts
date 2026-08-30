export const ANDROID_HOME_FAB_SIZE = 56;
export const ANDROID_HOME_FAB_BOTTOM_MARGIN = 16;
export const ANDROID_HOME_FAB_LIST_CLEARANCE = 16;
export const ANDROID_HOME_FAB_MIN_SAFE_BOTTOM_INSET = 16;

export interface AndroidHomeFabLayout {
  readonly fabBottom: number;
  readonly compactListBottomPadding: number;
  readonly sidebarListBottomPadding: number;
}

export function deriveAndroidHomeFabLayout(input: {
  readonly bottomInset: number;
}): AndroidHomeFabLayout {
  const bottomInset = Math.max(0, input.bottomInset);
  const safeBottomInset = Math.max(bottomInset, ANDROID_HOME_FAB_MIN_SAFE_BOTTOM_INSET);
  const fabBottom = safeBottomInset + ANDROID_HOME_FAB_BOTTOM_MARGIN;
  const listBottomClearance = fabBottom + ANDROID_HOME_FAB_SIZE + ANDROID_HOME_FAB_LIST_CLEARANCE;

  return {
    fabBottom,
    compactListBottomPadding: listBottomClearance,
    sidebarListBottomPadding: listBottomClearance - bottomInset,
  };
}
