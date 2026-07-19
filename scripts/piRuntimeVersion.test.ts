// @effect-diagnostics nodeBuiltinImport:off - This test reads repository files directly.
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vite-plus/test";
import { PI_SDK_PIN } from "@kata-sh/code-sandbox-contracts/piSdkPin";

const serverPackage = JSON.parse(
  readFileSync(new URL("../apps/server/package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string> };
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const dependabot = parseYaml(
  readFileSync(new URL("../.github/dependabot.yml", import.meta.url), "utf8"),
) as {
  version: number;
  updates: Array<{
    "package-ecosystem": string;
    directory: string;
    schedule: { interval: string; day?: string };
    "open-pull-requests-limit"?: number;
    cooldown?: {
      "default-days"?: number;
      "semver-major-days"?: number;
      "semver-minor-days"?: number;
      "semver-patch-days"?: number;
      exclude?: string[];
    };
    groups?: Record<string, unknown>;
    ignore?: Array<{ "dependency-name": string }>;
    allow?: Array<{ "dependency-name"?: string; "dependency-type"?: string }>;
    "commit-message"?: unknown;
  }>;
};
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

  it("keeps daily Pi-only npm Dependabot, weekly npm for the rest, and Actions coverage", () => {
    expect(dependabot.version).toBe(2);
    const npmUpdates = dependabot.updates.filter((entry) => entry["package-ecosystem"] === "npm");
    const actionsUpdates = dependabot.updates.filter(
      (entry) => entry["package-ecosystem"] === "github-actions",
    );
    expect(npmUpdates).toHaveLength(2);
    expect(actionsUpdates).toHaveLength(1);

    const dailyNpm = npmUpdates.find((entry) => entry.schedule.interval === "daily");
    expect(dailyNpm).toBeDefined();
    expect(dailyNpm!.directory).toBe("/");
    expect(dailyNpm!.schedule).toEqual({ interval: "daily" });
    expect(dailyNpm!["open-pull-requests-limit"]).toBe(10);
    expect(dailyNpm!.allow).toEqual([{ "dependency-name": "@earendil-works/pi-*" }]);
    expect(Object.keys(dailyNpm!.groups ?? {})).toEqual(["pi-runtime"]);
    expect(dailyNpm!.groups?.["pi-runtime"]).toEqual({
      patterns: ["@earendil-works/pi-*"],
    });
    expect(dailyNpm!.cooldown).toBeUndefined();
    expect(dailyNpm!.ignore).toBeUndefined();
    expect(dailyNpm!["commit-message"]).toBeUndefined();

    const weeklyNpm = npmUpdates.find((entry) => entry.schedule.interval === "weekly");
    expect(weeklyNpm).toBeDefined();
    expect(weeklyNpm!.directory).toBe("/");
    expect(weeklyNpm!.schedule).toEqual({ interval: "weekly", day: "monday" });
    expect(weeklyNpm!["open-pull-requests-limit"]).toBe(10);
    expect(weeklyNpm!.cooldown).toEqual({
      "default-days": 3,
      "semver-major-days": 7,
      "semver-minor-days": 3,
      "semver-patch-days": 3,
    });
    expect(Object.keys(weeklyNpm!.groups ?? {})).toEqual([
      "production-dependencies",
      "development-dependencies",
    ]);
    expect(weeklyNpm!.groups?.["production-dependencies"]).toEqual({
      "dependency-type": "production",
    });
    expect(weeklyNpm!.groups?.["development-dependencies"]).toEqual({
      "dependency-type": "development",
    });
    expect(weeklyNpm!.ignore).toEqual([
      { "dependency-name": "effect" },
      { "dependency-name": "@effect/*" },
      { "dependency-name": "@earendil-works/pi-*" },
    ]);
    expect(weeklyNpm!.allow).toBeUndefined();
    expect(weeklyNpm!["commit-message"]).toBeUndefined();

    const actions = actionsUpdates[0]!;
    expect(actions.directory).toBe("/");
    expect(actions.schedule).toEqual({ interval: "weekly", day: "monday" });
    expect(actions["open-pull-requests-limit"]).toBe(5);
    expect(actions.cooldown).toEqual({
      "default-days": 3,
      "semver-major-days": 7,
      "semver-minor-days": 3,
      "semver-patch-days": 3,
    });
    expect(actions.groups).toEqual({
      "github-actions": { patterns: ["*"] },
    });
  });
});
