import { describe, expect, it } from "vitest";

import { buildMaestroArgs } from "./maestroRunner.ts";

describe("buildMaestroArgs", () => {
  it("builds a `test` invocation with flow paths last", () => {
    const args = buildMaestroArgs({ flowPaths: ["mobile-e2e/maestro/smoke/launch.yaml"] });
    expect(args[0]).toBe("test");
    expect(args.at(-1)).toBe("mobile-e2e/maestro/smoke/launch.yaml");
  });

  it("maps @-prefixed and bare tags to comma-joined bare names after --include-tags", () => {
    // Maestro's --include-tags rejects the leading @, so the runner must strip it.
    const args = buildMaestroArgs({
      flowPaths: ["mobile-e2e/maestro/smoke/launch.yaml"],
      includeTags: ["@smoke", "pairing"],
    });
    const flagIndex = args.indexOf("--include-tags");
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(args[flagIndex + 1]).toBe("smoke,pairing");
  });

  it("emits one -e KEY=VALUE per injected variable so flows read dynamic token/host", () => {
    const args = buildMaestroArgs({
      flowPaths: ["f.yaml"],
      env: { HOST: "127.0.0.1:3773", TOKEN: "abc" },
    });
    const joined = args.join(" ");
    expect(joined).toContain("-e HOST=127.0.0.1:3773");
    expect(joined).toContain("-e TOKEN=abc");
  });

  it("includes report format, output path, and debug output only when provided", () => {
    const withReport = buildMaestroArgs({
      flowPaths: ["f.yaml"],
      format: "junit",
      outputPath: "out/report.xml",
      debugOutputPath: "out/debug",
    });
    expect(withReport).toContain("--format");
    expect(withReport).toContain("junit");
    expect(withReport).toContain("--output");
    expect(withReport).toContain("out/report.xml");
    expect(withReport).toContain("--debug-output");
    expect(withReport).toContain("out/debug");

    const withoutReport = buildMaestroArgs({ flowPaths: ["f.yaml"] });
    expect(withoutReport).not.toContain("--format");
    expect(withoutReport).not.toContain("--output");
    expect(withoutReport).not.toContain("--debug-output");
  });
});
