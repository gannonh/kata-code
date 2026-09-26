// Upstream coverage for `processRunner.ts` that the frozen `processRunner.test.ts`
// cannot carry; see docs/upstream/kat-3496-intake.md.
import { describe, expect, it } from "@effect/vitest";

import * as ProcessRunner from "./processRunner.ts";

describe("commandName", () => {
  it("drops the directory from POSIX and Windows paths", () => {
    expect(ProcessRunner.commandName("/Users/me/.local/bin/claude")).toBe("claude");
    expect(ProcessRunner.commandName("C:\\Program Files\\nodejs\\npx.cmd")).toBe("npx.cmd");
    expect(ProcessRunner.commandName("git")).toBe("git");
  });
});
