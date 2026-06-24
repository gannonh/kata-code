import { describe, expect, it } from "vitest";

import { selectSimulator } from "./simulator.ts";

const sample = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-2": [
      { udid: "AAA", name: "iPhone 16", state: "Shutdown", isAvailable: true },
      { udid: "BBB", name: "iPhone 16 Pro", state: "Booted", isAvailable: true },
      { udid: "CCC", name: "Broken", state: "Shutdown", isAvailable: false },
    ],
  },
});

describe("selectSimulator", () => {
  it("prefers a booted available device when no preference is given", () => {
    // Driving the already-booted simulator avoids an extra boot and matches what
    // a developer sees on screen.
    expect(selectSimulator(sample)?.udid).toBe("BBB");
  });

  it("falls back to the first available device when none is booted", () => {
    const noneBooted = JSON.stringify({
      devices: {
        rt: [
          { udid: "AAA", name: "iPhone 16", state: "Shutdown", isAvailable: true },
          { udid: "CCC", name: "Broken", state: "Shutdown", isAvailable: false },
        ],
      },
    });
    expect(selectSimulator(noneBooted)?.udid).toBe("AAA");
  });

  it("matches an explicit preference by name or udid regardless of state", () => {
    expect(selectSimulator(sample, "iPhone 16")?.udid).toBe("AAA");
    expect(selectSimulator(sample, "BBB")?.udid).toBe("BBB");
  });

  it("returns undefined when a requested simulator is not found", () => {
    expect(selectSimulator(sample, "Pixel 9")).toBeUndefined();
  });

  it("never selects an unavailable device", () => {
    expect(selectSimulator(sample, "Broken")).toBeUndefined();
  });
});
