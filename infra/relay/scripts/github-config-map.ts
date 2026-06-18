import {
  RELAY_DEPLOY_REGISTRY,
  RELAY_DEPLOY_SECRET_NAMES,
  RELAY_DEPLOY_SMOKE_REGISTRY,
  RELAY_GITHUB_PRODUCTION_SECRETS,
  RELAY_GITHUB_PRODUCTION_VARIABLES,
  RELAY_GITHUB_REPO_VARIABLES,
} from "./deploy-config.ts";

export {
  RELAY_GITHUB_PRODUCTION_SECRETS,
  RELAY_GITHUB_PRODUCTION_VARIABLES,
  RELAY_GITHUB_REPO_VARIABLES,
} from "./deploy-config.ts";

export interface RelayGithubSyncPlan {
  readonly repoVariables: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly productionVariables: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly productionSecrets: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly missing: ReadonlyArray<string>;
}

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function collectGithubEntries(
  names: ReadonlyArray<string>,
  env: Readonly<Record<string, string | undefined>>,
): ReadonlyArray<{ readonly name: string; readonly value: string }> {
  return names.flatMap((name) => {
    const value = trimmed(env[name]);
    return value ? [{ name, value }] : [];
  });
}

export function buildRelayGithubSyncPlan(
  env: Readonly<Record<string, string | undefined>>,
): RelayGithubSyncPlan {
  const repoVariables = collectGithubEntries(RELAY_GITHUB_REPO_VARIABLES, env);
  const productionVariables = collectGithubEntries(RELAY_GITHUB_PRODUCTION_VARIABLES, env);
  const productionSecrets = collectGithubEntries(RELAY_GITHUB_PRODUCTION_SECRETS, env);

  const required = [
    ...RELAY_GITHUB_REPO_VARIABLES,
    ...RELAY_DEPLOY_REGISTRY.filter(
      (entry) => entry.kind === "variable" && entry.github === "production",
    ).map((entry) => entry.name),
    ...RELAY_DEPLOY_SMOKE_REGISTRY.map((entry) => entry.name),
    ...RELAY_DEPLOY_SECRET_NAMES,
  ];
  const missing = required.filter((name) => !trimmed(env[name]));

  return {
    repoVariables,
    productionVariables,
    productionSecrets,
    missing,
  };
}
