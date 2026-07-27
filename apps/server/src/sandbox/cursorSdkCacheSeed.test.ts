import { describe, expect, it } from "vite-plus/test";

import { buildRefreshCursorModelListCacheCommand } from "./cursorSdkCacheSeed.ts";

describe("buildRefreshCursorModelListCacheCommand", () => {
  it("targets the seeded model-list cache under the sandbox home", () => {
    const command = buildRefreshCursorModelListCacheCommand("/home/katacode");
    expect(command.startsWith("node -e '")).toBe(true);
    expect(command).toContain("/home/katacode/.pi/agent/cursor-sdk-model-list.json");
    expect(command).toContain("fetchedAt=Date.now()");
    expect(command).toContain("keyFingerprint");
  });

  it("strips trailing slashes from home", () => {
    const command = buildRefreshCursorModelListCacheCommand("/home/katacode/");
    expect(command).toContain("/home/katacode/.pi/agent/cursor-sdk-model-list.json");
    expect(command).not.toContain("/home/katacode//.pi");
  });

  it("shell-escapes single quotes that appear inside the node script", () => {
    const command = buildRefreshCursorModelListCacheCommand("/home/o'hara");
    // Path is JSON-stringified inside a single-quoted `node -e` script, so the
    // apostrophe in the home segment must be escaped for the shell wrapper.
    expect(command).toContain(`o'\\''hara`);
    expect(command).toContain("cursor-sdk-model-list.json");
  });
});
