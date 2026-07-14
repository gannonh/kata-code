import type { LaunchTarget } from "./isolatedRun.ts";

export type AppTarget = "desktop" | "web";

export interface AppProject {
  readonly appTarget: AppTarget;
  readonly launchTarget: LaunchTarget;
}

export function resolveAppProject(projectName: string, metadata: unknown): AppProject {
  if (typeof metadata !== "object" || metadata === null) {
    throw new Error(
      `E2E project "${projectName}" must define metadata.appTarget as "web" or "desktop" and metadata.launchTarget as "dev" or "release".`,
    );
  }

  const appTarget = "appTarget" in metadata ? metadata.appTarget : undefined;
  const launchTarget = "launchTarget" in metadata ? metadata.launchTarget : undefined;
  if (appTarget !== "web" && appTarget !== "desktop") {
    throw new Error(
      `E2E project "${projectName}" must define metadata.appTarget as "web" or "desktop".`,
    );
  }
  if (launchTarget !== "dev" && launchTarget !== "release") {
    throw new Error(
      `E2E project "${projectName}" must define metadata.launchTarget as "dev" or "release".`,
    );
  }
  if (appTarget === "web" && launchTarget === "release") {
    throw new Error(`E2E project "${projectName}" cannot use a web release launch target.`);
  }

  return { appTarget, launchTarget };
}
