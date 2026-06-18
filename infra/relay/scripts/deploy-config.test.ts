import { describe, expect, it } from "@effect/vitest";

import {
  RELAY_CLIENT_ENV_MAPPINGS,
  RELAY_DEPLOY_REGISTRY,
  RELAY_DEPLOY_SECRET_NAMES,
  RELAY_DEPLOY_VARIABLE_NAMES,
  RELAY_GITHUB_REPO_VARIABLES,
  resolveRelayDeployConfig,
  resolveRelayDeploySmokeConfig,
} from "./deploy-config.ts";

function filledRecord(names: ReadonlyArray<string>, prefix: string) {
  return Object.fromEntries(names.map((name) => [name, `${prefix}-${name}`]));
}

describe("relay deploy registry", () => {
  it("derives repo GitHub variables from registry metadata", () => {
    expect(RELAY_GITHUB_REPO_VARIABLES).toEqual(
      RELAY_DEPLOY_REGISTRY.filter(
        (entry) => entry.kind === "variable" && entry.github === "repo",
      ).map((entry) => entry.name),
    );
  });

  it("maps clerk relay env keys to client env keys", () => {
    expect(RELAY_CLIENT_ENV_MAPPINGS).toEqual(
      RELAY_DEPLOY_REGISTRY.filter((entry) => "clientEnvKey" in entry).map((entry) => ({
        source: entry.name,
        target: entry.clientEnvKey,
      })),
    );
  });
});

describe("resolveRelayDeployConfig", () => {
  it("reports all missing production deploy variables and secrets", () => {
    const status = resolveRelayDeployConfig({}, {});
    expect(status.ready).toBe(false);
    expect(status.missingVariables).toEqual([...RELAY_DEPLOY_VARIABLE_NAMES]);
    expect(status.missingSecrets).toEqual([...RELAY_DEPLOY_SECRET_NAMES]);
  });

  it("passes when required production deploy inputs are present", () => {
    const status = resolveRelayDeployConfig(
      filledRecord(RELAY_DEPLOY_VARIABLE_NAMES, "var"),
      filledRecord(RELAY_DEPLOY_SECRET_NAMES, "secret"),
    );
    expect(status).toEqual({
      missingVariables: [],
      missingSecrets: [],
      ready: true,
    });
  });
});

describe("resolveRelayDeploySmokeConfig", () => {
  it("requires a dedicated Clerk smoke user id", () => {
    expect(resolveRelayDeploySmokeConfig({})).toEqual(["CLERK_SMOKE_USER_ID"]);
    expect(resolveRelayDeploySmokeConfig({ CLERK_SMOKE_USER_ID: "user_smoke" })).toEqual([]);
  });
});
