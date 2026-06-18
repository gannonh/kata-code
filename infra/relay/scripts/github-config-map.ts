import {
  RELAY_DEPLOY_SECRET_NAMES,
  RELAY_DEPLOY_SMOKE_VARIABLE_NAMES,
  RELAY_DEPLOY_VARIABLE_NAMES,
} from "./deploy-config.ts";

export const RELAY_GITHUB_REPO_VARIABLES = [
  "CLOUDFLARE_ACCOUNT_ID",
  "PLANETSCALE_ORGANIZATION",
  "AXIOM_ORG_ID",
] as const;

const RELAY_GITHUB_REPO_VARIABLE_SET = new Set<string>(RELAY_GITHUB_REPO_VARIABLES);

const RELAY_GITHUB_PRODUCTION_DEPLOY_VARIABLES = RELAY_DEPLOY_VARIABLE_NAMES.filter(
  (name) => !RELAY_GITHUB_REPO_VARIABLE_SET.has(name),
);

export const RELAY_GITHUB_PRODUCTION_VARIABLES = [
  ...RELAY_GITHUB_PRODUCTION_DEPLOY_VARIABLES,
  ...RELAY_DEPLOY_SMOKE_VARIABLE_NAMES,
  "RELAY_DOMAIN",
] as const;

export const RELAY_GITHUB_PRODUCTION_SECRETS = [...RELAY_DEPLOY_SECRET_NAMES] as const;

export type RelayGithubRepoVariable = (typeof RELAY_GITHUB_REPO_VARIABLES)[number];
export type RelayGithubProductionVariable = (typeof RELAY_GITHUB_PRODUCTION_VARIABLES)[number];
export type RelayGithubProductionSecret = (typeof RELAY_GITHUB_PRODUCTION_SECRETS)[number];

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

export function buildRelayGithubSyncPlan(
  env: Readonly<Record<string, string | undefined>>,
): RelayGithubSyncPlan {
  const repoVariables = RELAY_GITHUB_REPO_VARIABLES.flatMap((name) => {
    const value = trimmed(env[name]);
    return value ? [{ name, value }] : [];
  });
  const productionVariables = RELAY_GITHUB_PRODUCTION_VARIABLES.flatMap((name) => {
    const value = trimmed(env[name]);
    return value ? [{ name, value }] : [];
  });
  const productionSecrets = RELAY_GITHUB_PRODUCTION_SECRETS.flatMap((name) => {
    const value = trimmed(env[name]);
    return value ? [{ name, value }] : [];
  });

  const required = [
    ...RELAY_GITHUB_REPO_VARIABLES,
    ...RELAY_GITHUB_PRODUCTION_DEPLOY_VARIABLES,
    ...RELAY_DEPLOY_SMOKE_VARIABLE_NAMES,
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
