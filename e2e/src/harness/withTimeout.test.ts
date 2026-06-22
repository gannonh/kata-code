import { describe, expect, it } from "vitest";

import { TimeoutError, withTimeout } from "./withTimeout.ts";

describe("withTimeout", () => {
  it("resolves when the operation finishes in time", async () => {
    await expect(withTimeout("fast op", 1_000, async () => "ok")).resolves.toBe("ok");
  });

  it("rejects with a labeled timeout error", async () => {
    await expect(
      withTimeout("slow op", 25, async (signal) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 100);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason);
          });
        });
        return "late";
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
