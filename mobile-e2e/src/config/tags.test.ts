import { describe, expect, it } from "vitest";

import { MOBILE_E2E_TAGS, toMaestroTag } from "./tags.ts";

describe("toMaestroTag", () => {
  it("strips a leading @ so Maestro's --include-tags accepts the name", () => {
    expect(toMaestroTag("@smoke")).toBe("smoke");
  });

  it("leaves an already-bare tag unchanged", () => {
    expect(toMaestroTag("pairing")).toBe("pairing");
  });

  it("covers every declared tag", () => {
    for (const tag of Object.values(MOBILE_E2E_TAGS)) {
      expect(toMaestroTag(tag)).toBe(tag.slice(1));
    }
  });
});
