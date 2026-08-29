import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@effect/atom-react", () => ({
  useAtomSet: vi.fn(),
  useAtomValue: vi.fn(),
}));
vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: {},
  updateMobilePreferencesAtom: {},
}));
vi.mock("react", () => ({
  useCallback: (fn: () => void) => fn,
  useEffect: vi.fn(),
  useRef: (initial: unknown) => ({ current: initial }),
}));

import {
  flipThreadListV2ShelfPatch,
  resolveThreadListV2ShelfExpansion,
  THREAD_LIST_V2_SHELF_DEFAULTS,
} from "./use-thread-list-v2-shelf-preferences";

describe("thread list v2 shelf preferences", () => {
  it("defaults settled expanded and snoozed collapsed", () => {
    expect(THREAD_LIST_V2_SHELF_DEFAULTS).toEqual({ settled: true, snoozed: false });
  });

  it("resolves defaults from an empty preference object", () => {
    expect(resolveThreadListV2ShelfExpansion({})).toEqual({
      settled: true,
      snoozed: false,
    });
  });

  it("resolves stored shelf expansion booleans", () => {
    expect(
      resolveThreadListV2ShelfExpansion({
        threadListV2SettledShelfExpanded: false,
        threadListV2SnoozedShelfExpanded: true,
      }),
    ).toEqual({ settled: false, snoozed: true });
  });

  it("flips settled and snoozed from defaults", () => {
    expect(flipThreadListV2ShelfPatch("settled", {})).toEqual({
      threadListV2SettledShelfExpanded: false,
    });
    expect(flipThreadListV2ShelfPatch("snoozed", {})).toEqual({
      threadListV2SnoozedShelfExpanded: true,
    });
  });

  it("flips settled and snoozed from stored values", () => {
    const prefs = {
      threadListV2SettledShelfExpanded: false,
      threadListV2SnoozedShelfExpanded: true,
    };
    expect(flipThreadListV2ShelfPatch("settled", prefs)).toEqual({
      threadListV2SettledShelfExpanded: true,
    });
    expect(flipThreadListV2ShelfPatch("snoozed", prefs)).toEqual({
      threadListV2SnoozedShelfExpanded: false,
    });
  });
});
