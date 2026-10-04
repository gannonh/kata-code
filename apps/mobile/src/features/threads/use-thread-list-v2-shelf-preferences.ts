import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useRef } from "react";

import type { Preferences } from "../../persistence/mobile-preferences";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";

export const THREAD_LIST_V2_SHELF_DEFAULTS = { settled: true, snoozed: false } as const;

export function resolveThreadListV2ShelfExpansion(
  prefs: Pick<Preferences, "threadListV2SettledShelfExpanded" | "threadListV2SnoozedShelfExpanded">,
): { settled: boolean; snoozed: boolean } {
  return {
    settled: prefs.threadListV2SettledShelfExpanded !== false,
    snoozed: prefs.threadListV2SnoozedShelfExpanded === true,
  };
}

export function flipThreadListV2ShelfPatch(
  shelf: "settled" | "snoozed",
  prefs: Pick<Preferences, "threadListV2SettledShelfExpanded" | "threadListV2SnoozedShelfExpanded">,
): Partial<Preferences> {
  const expansion = resolveThreadListV2ShelfExpansion(prefs);
  if (shelf === "settled") {
    return { threadListV2SettledShelfExpanded: !expansion.settled };
  }
  return { threadListV2SnoozedShelfExpanded: !expansion.snoozed };
}

export function useThreadListV2ShelfPreferences() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferencesResult);
  const expansion = loaded
    ? resolveThreadListV2ShelfExpansion(preferencesResult.value)
    : THREAD_LIST_V2_SHELF_DEFAULTS;
  const settledShelfExpanded = expansion.settled;
  const snoozedShelfExpanded = expansion.snoozed;
  // Working section beta: off until the preference loads and is enabled.
  const workingShelfEnabled = loaded && preferencesResult.value.workingShelfEnabled === true;
  const workingShelfExpanded =
    loaded && preferencesResult.value.threadListV2WorkingShelfExpanded === true;

  const settledRef = useRef(settledShelfExpanded);
  const snoozedRef = useRef(snoozedShelfExpanded);
  const workingShelfExpandedRef = useRef(workingShelfExpanded);
  settledRef.current = settledShelfExpanded;
  snoozedRef.current = snoozedShelfExpanded;
  workingShelfExpandedRef.current = workingShelfExpanded;

  const toggleSettledShelf = useCallback(() => {
    if (!loaded) return;
    const expanded = !settledRef.current;
    settledRef.current = expanded;
    savePreferences({ threadListV2SettledShelfExpanded: expanded });
  }, [loaded, savePreferences]);

  const toggleSnoozedShelf = useCallback(() => {
    if (!loaded) return;
    const expanded = !snoozedRef.current;
    snoozedRef.current = expanded;
    savePreferences({ threadListV2SnoozedShelfExpanded: expanded });
  }, [loaded, savePreferences]);

  const toggleWorkingShelf = useCallback(() => {
    if (!loaded) return;
    const expanded = !workingShelfExpandedRef.current;
    workingShelfExpandedRef.current = expanded;
    savePreferences({ threadListV2WorkingShelfExpanded: expanded });
  }, [loaded, savePreferences]);

  return {
    loaded,
    settledShelfExpanded,
    snoozedShelfExpanded,
    workingShelfEnabled,
    workingShelfExpanded,
    toggleSettledShelf,
    toggleSnoozedShelf,
    toggleWorkingShelf,
  } as const;
}
