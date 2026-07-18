// @effect-diagnostics nodeBuiltinImport:off - This test reads repository files directly.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
// @ts-ignore TS6307 - The alignment gate intentionally reads the Vercel package source.
import { PI_SDK_PIN } from "../packages/sandbox-vercel/src/bootstrap.ts";

const serverPackage = JSON.parse(
  readFileSync(new URL("../apps/server/package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string> };
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const PI_PACKAGES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-agent-core",
] as const;

describe("Pi runtime version alignment", () => {
  it("pins server, Vercel, and Docker to one exact version", () => {
    expect(PI_PACKAGES.map((name) => serverPackage.dependencies[name])).toEqual([
      PI_SDK_PIN,
      PI_SDK_PIN,
      PI_SDK_PIN,
    ]);
    expect(dockerfile).toContain(`ARG PI_SDK_VERSION=${PI_SDK_PIN}`);
    for (const name of PI_PACKAGES) {
      expect(dockerfile).toContain(`${name}@\${PI_SDK_VERSION}`);
    }
  });
});
