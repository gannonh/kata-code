export type RelayDeployKeyKind = "variable" | "secret";
export type RelayDeployGithubDestination = "repo" | "production";

export interface RelayDeployKeyDef {
  readonly name: string;
  readonly kind: RelayDeployKeyKind;
  readonly github?: RelayDeployGithubDestination;
  readonly githubOptional?: boolean;
  readonly clientEnvKey?: string;
}

export const RELAY_DEPLOY_REGISTRY = [
  { name: "CLOUDFLARE_ACCOUNT_ID", kind: "variable", github: "repo" },
  { name: "PLANETSCALE_ORGANIZATION", kind: "variable", github: "repo" },
  { name: "AXIOM_ORG_ID", kind: "variable", github: "repo" },
  { name: "RELAY_API_ZONE_NAME", kind: "variable", github: "production" },
  { name: "RELAY_TUNNEL_ZONE_NAME", kind: "variable", github: "production" },
  {
    name: "CLERK_PUBLISHABLE_KEY",
    kind: "variable",
    github: "production",
    clientEnvKey: "KATACODE_CLERK_PUBLISHABLE_KEY",
  },
  { name: "CLERK_JWT_AUDIENCE", kind: "variable", github: "production" },
  {
    name: "CLERK_JWT_TEMPLATE",
    kind: "variable",
    github: "production",
    clientEnvKey: "KATACODE_CLERK_JWT_TEMPLATE",
  },
  {
    name: "CLERK_CLI_OAUTH_CLIENT_ID",
    kind: "variable",
    github: "production",
    clientEnvKey: "KATACODE_CLERK_CLI_OAUTH_CLIENT_ID",
  },
  { name: "APNS_ENVIRONMENT", kind: "variable", github: "production" },
  { name: "APNS_TEAM_ID", kind: "variable", github: "production" },
  { name: "APNS_KEY_ID", kind: "variable", github: "production" },
  { name: "APNS_BUNDLE_ID", kind: "variable", github: "production" },
  { name: "CLOUDFLARE_API_TOKEN", kind: "secret", github: "production" },
  { name: "PLANETSCALE_API_TOKEN_ID", kind: "secret", github: "production" },
  { name: "PLANETSCALE_API_TOKEN", kind: "secret", github: "production" },
  { name: "AXIOM_TOKEN", kind: "secret", github: "production" },
  { name: "CLERK_SECRET_KEY", kind: "secret", github: "production" },
  { name: "APNS_PRIVATE_KEY", kind: "secret", github: "production" },
] as const satisfies ReadonlyArray<RelayDeployKeyDef>;

export const RELAY_DEPLOY_SMOKE_REGISTRY = [
  { name: "CLERK_SMOKE_USER_ID", kind: "variable", github: "production" },
] as const satisfies ReadonlyArray<RelayDeployKeyDef>;

export const RELAY_DEPLOY_OPTIONAL_REGISTRY = [
  { name: "RELAY_DOMAIN", kind: "variable", github: "production", githubOptional: true },
] as const satisfies ReadonlyArray<RelayDeployKeyDef>;

function namesWhere(
  registry: ReadonlyArray<RelayDeployKeyDef>,
  predicate: (entry: RelayDeployKeyDef) => boolean,
): ReadonlyArray<string> {
  return registry.filter(predicate).map((entry) => entry.name);
}

export const RELAY_DEPLOY_VARIABLE_NAMES = namesWhere(
  RELAY_DEPLOY_REGISTRY,
  (entry) => entry.kind === "variable",
);
export const RELAY_DEPLOY_SECRET_NAMES = namesWhere(
  RELAY_DEPLOY_REGISTRY,
  (entry) => entry.kind === "secret",
);
export const RELAY_DEPLOY_SMOKE_VARIABLE_NAMES = namesWhere(
  RELAY_DEPLOY_SMOKE_REGISTRY,
  (entry) => entry.kind === "variable",
);

export const RELAY_GITHUB_REPO_VARIABLES = namesWhere(
  RELAY_DEPLOY_REGISTRY,
  (entry) => entry.kind === "variable" && entry.github === "repo",
);

export const RELAY_GITHUB_PRODUCTION_VARIABLES = [
  ...namesWhere(
    RELAY_DEPLOY_REGISTRY,
    (entry) => entry.kind === "variable" && entry.github === "production",
  ),
  ...RELAY_DEPLOY_SMOKE_VARIABLE_NAMES,
  ...namesWhere(RELAY_DEPLOY_OPTIONAL_REGISTRY, (entry) => entry.kind === "variable"),
] as const;

export const RELAY_GITHUB_PRODUCTION_SECRETS = [...RELAY_DEPLOY_SECRET_NAMES] as const;

export const RELAY_CLIENT_ENV_MAPPINGS = [
  { source: "CLERK_PUBLISHABLE_KEY", target: "KATACODE_CLERK_PUBLISHABLE_KEY" },
  { source: "CLERK_JWT_TEMPLATE", target: "KATACODE_CLERK_JWT_TEMPLATE" },
  { source: "CLERK_CLI_OAUTH_CLIENT_ID", target: "KATACODE_CLERK_CLI_OAUTH_CLIENT_ID" },
] as const;

export interface RelayDeployConfigStatus {
  readonly missingVariables: ReadonlyArray<string>;
  readonly missingSecrets: ReadonlyArray<string>;
  readonly ready: boolean;
}

function missingNames(
  names: ReadonlyArray<string>,
  source: Readonly<Record<string, string | undefined>>,
): ReadonlyArray<string> {
  return names.filter((name) => !source[name]?.trim());
}

export function resolveRelayDeployConfig(
  variables: Readonly<Record<string, string | undefined>>,
  secrets: Readonly<Record<string, string | undefined>>,
): RelayDeployConfigStatus {
  const missingVariables = missingNames([...RELAY_DEPLOY_VARIABLE_NAMES], variables);
  const missingSecrets = missingNames([...RELAY_DEPLOY_SECRET_NAMES], secrets);
  return {
    missingVariables,
    missingSecrets,
    ready: missingVariables.length === 0 && missingSecrets.length === 0,
  };
}

export function resolveRelayDeploySmokeConfig(
  variables: Readonly<Record<string, string | undefined>>,
): ReadonlyArray<string> {
  return missingNames([...RELAY_DEPLOY_SMOKE_VARIABLE_NAMES], variables);
}
