import {
  isPathQualifiedProviderSkillToken,
  makeProviderSkillInvocationToken,
} from "./providerSkills.ts";
import { describe, expect, it } from "vite-plus/test";

describe("providerSkills", () => {
  it("treats skill names containing colons as path-qualified tokens", () => {
    const token = makeProviderSkillInvocationToken({
      name: "foo:bar",
      path: "/tmp/skills/foo-bar/SKILL.md",
    });

    expect(token.startsWith("skill:foo:bar:")).toBe(true);
    expect(isPathQualifiedProviderSkillToken(token)).toBe(true);
    expect(isPathQualifiedProviderSkillToken("foo:bar:baz")).toBe(false);
  });
});
