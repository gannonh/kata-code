import { describe, expect, it } from "vitest";

import { parseCliArgs } from "./args.ts";

describe("parseCliArgs", () => {
  it("defaults to a run with no tag filter", () => {
    const parsed = parseCliArgs([]);
    expect(parsed).toEqual({ mode: "run", tags: [] });
  });

  it("parses --include-tags with a comma-joined value", () => {
    expect(parseCliArgs(["--include-tags", "@smoke,@pairing"]).tags).toEqual([
      "@smoke",
      "@pairing",
    ]);
  });

  it("accepts --include-tags=value form and bare tags, normalizing to @-prefixed", () => {
    // Internally tags are stored @-prefixed to match MOBILE_E2E_TAGS and the
    // credential-gating logic; the Maestro runner strips the @ later.
    expect(parseCliArgs(["--include-tags=smoke"]).tags).toEqual(["@smoke"]);
  });

  it("unions repeated --include-tags flags", () => {
    expect(parseCliArgs(["--include-tags", "@smoke", "--include-tags", "@agent"]).tags).toEqual([
      "@smoke",
      "@agent",
    ]);
  });

  it("recognizes --list, --studio, and --help modes", () => {
    expect(parseCliArgs(["--list"]).mode).toBe("list");
    expect(parseCliArgs(["--studio"]).mode).toBe("studio");
    expect(parseCliArgs(["--help"]).mode).toBe("help");
  });
});
