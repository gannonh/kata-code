import { describe, expect, it } from "vitest";

import { parseFlowTags } from "./flows.ts";

describe("parseFlowTags", () => {
  it("extracts @-prefixed tags from a Maestro flow header", () => {
    const yaml = [
      "appId: com.katacode.dev",
      "tags:",
      "  - smoke",
      "  - pairing",
      "---",
      "- launchApp",
    ].join("\n");
    expect(parseFlowTags(yaml)).toEqual(["@smoke", "@pairing"]);
  });

  it("returns an empty list when no tags block is present", () => {
    expect(parseFlowTags("appId: com.katacode.dev\n---\n- launchApp\n")).toEqual([]);
  });

  it("stops at the end of the tags block", () => {
    // A following key must not be swallowed into the tags list.
    const yaml = "tags:\n  - agent\nappId: com.katacode.dev\n---\n";
    expect(parseFlowTags(yaml)).toEqual(["@agent"]);
  });
});
