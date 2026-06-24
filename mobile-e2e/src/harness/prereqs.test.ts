import { describe, expect, it } from "vitest";

import { requiredCredentialGroupsForTags, runNeedsServer } from "./prereqs.ts";

describe("requiredCredentialGroupsForTags", () => {
  it("requires no credentials for smoke or bearer pairing", () => {
    // The proven bearer loopback path needs no Clerk or provider creds.
    expect(requiredCredentialGroupsForTags(["@smoke"])).toEqual([]);
    expect(requiredCredentialGroupsForTags(["@pairing"])).toEqual([]);
  });

  it("requires Clerk and Google creds for @auth", () => {
    expect(requiredCredentialGroupsForTags(["@auth"]).sort()).toEqual(["clerk", "google"]);
  });

  it("requires provider creds for @agent", () => {
    expect(requiredCredentialGroupsForTags(["@agent"])).toEqual(["agent"]);
  });

  it("unions groups across multiple tags without duplicates", () => {
    expect(requiredCredentialGroupsForTags(["@auth", "@agent"]).sort()).toEqual([
      "agent",
      "clerk",
      "google",
    ]);
  });

  it("treats an empty tag filter as running everything (all creds required)", () => {
    // No --include-tags means every flow runs, so every credential group is needed.
    expect(requiredCredentialGroupsForTags([]).sort()).toEqual(["agent", "clerk", "google"]);
  });
});

describe("runNeedsServer", () => {
  it("skips the server for a smoke-only run", () => {
    // @smoke only launches the app; standing up a real server would add failure
    // surface for nothing.
    expect(runNeedsServer(["@smoke"])).toBe(false);
  });

  it("requires the server for pairing, auth, agent, and unfiltered runs", () => {
    expect(runNeedsServer(["@pairing"])).toBe(true);
    expect(runNeedsServer(["@agent"])).toBe(true);
    expect(runNeedsServer(["@smoke", "@pairing"])).toBe(true);
    expect(runNeedsServer([])).toBe(true);
  });
});
