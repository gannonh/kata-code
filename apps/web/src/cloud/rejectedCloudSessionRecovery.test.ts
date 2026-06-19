import { describe, expect, it, vi } from "vite-plus/test";

import { recoverRejectedCloudSession } from "./rejectedCloudSessionRecovery";

describe("rejected cloud session recovery", () => {
  it("clears stale desktop auth before signing out and prompting sign-in", async () => {
    const calls: string[] = [];

    await recoverRejectedCloudSession({
      clearCloudAuthToken: vi.fn(async () => {
        calls.push("clear");
      }),
      signOut: vi.fn(async () => {
        calls.push("sign-out");
      }),
      openAuthPrompt: vi.fn(() => {
        calls.push("prompt");
      }),
    });

    expect(calls).toEqual(["clear", "sign-out", "prompt"]);
  });

  it("still signs out when clearing the stale desktop token fails", async () => {
    const calls: string[] = [];
    const warn = vi.fn();

    await recoverRejectedCloudSession({
      clearCloudAuthToken: vi.fn(async () => {
        calls.push("clear");
        throw new Error("clear failed");
      }),
      signOut: vi.fn(async () => {
        calls.push("sign-out");
      }),
      openAuthPrompt: vi.fn(() => {
        calls.push("prompt");
      }),
      warn,
    });

    expect(calls).toEqual(["clear", "sign-out", "prompt"]);
    expect(warn).toHaveBeenCalledWith(
      "Could not clear stale desktop cloud auth token.",
      expect.any(Error),
    );
  });
});
