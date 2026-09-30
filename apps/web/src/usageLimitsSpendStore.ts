import { create } from "zustand";

/**
 * How many times each thread has started quota-spending work since load. The
 * open /usage-limits panel is `ChatView` state, but queued follow-ups also send
 * from `sendQueuedMessage` while their thread is not on screen. Both report
 * here, and the panel's key includes the count, so a send closes it either way.
 */
interface UsageLimitsSpendStoreState {
  spendsByThreadKey: Record<string, number>;
  /** A turn started on the thread, so any limits snapshot shown for it is stale. */
  noteSpend: (threadKey: string) => void;
}

/** In-memory only: the count only has to differ from the one a panel opened with. */
export const useUsageLimitsSpendStore = create<UsageLimitsSpendStoreState>()((set) => ({
  spendsByThreadKey: {},
  noteSpend: (threadKey) =>
    set((state) => ({
      spendsByThreadKey: {
        ...state.spendsByThreadKey,
        [threadKey]: (state.spendsByThreadKey[threadKey] ?? 0) + 1,
      },
    })),
}));
