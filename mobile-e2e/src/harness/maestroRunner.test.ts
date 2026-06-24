import { describe, expect, it } from "vitest";

import { buildMaestroArgs } from "./maestroRunner.ts";

describe("buildMaestroArgs", () => {
  it("builds a `test` invocation with the flow path last", () => {
    const args = buildMaestroArgs({ flowPath: "mobile-e2e/maestro" });
    expect(args[0]).toBe("test");
    expect(args.at(-1)).toBe("mobile-e2e/maestro");
  });

  it("maps @-prefixed and bare tags to comma-joined bare names after --include-tags", () => {
    // Maestro's --include-tags rejects the leading @, so the runner must strip it.
    const args = buildMaestroArgs({
      flowPath: "mobile-e2e/maestro",
      includeTags: ["@smoke", "pairing"],
    });
    const flagIndex = args.indexOf("--include-tags");
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(args[flagIndex + 1]).toBe("smoke,pairing");
  });

  it("emits one -e KEY=VALUE per injected variable so flows read dynamic token/host", () => {
    const args = buildMaestroArgs({
      flowPath: "f.yaml",
      env: { HOST: "127.0.0.1:3773", TOKEN: "abc" },
    });
    const joined = args.join(" ");
    expect(joined).toContain("-e HOST=127.0.0.1:3773");
    expect(joined).toContain("-e TOKEN=abc");
  });

  it("includes report format and output path only when provided", () => {
    const withReport = buildMaestroArgs({
      flowPath: "f.yaml",
      format: "junit",
      outputPath: "out/report.xml",
    });
    expect(withReport).toContain("--format");
    expect(withReport).toContain("junit");
    expect(withReport).toContain("--output");
    expect(withReport).toContain("out/report.xml");

    const withoutReport = buildMaestroArgs({ flowPath: "f.yaml" });
    expect(withoutReport).not.toContain("--format");
    expect(withoutReport).not.toContain("--output");
  });
});
