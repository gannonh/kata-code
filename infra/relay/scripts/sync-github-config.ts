#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Relay bootstrap scripts load dotenv before Effect exists.

import { spawnSync } from "node:child_process";

import { buildRelayGithubSyncPlan } from "./github-config-map.ts";
import { loadRelayEnvFile } from "./relay-env.ts";

function runGh(args: ReadonlyArray<string>, input?: string) {
  const result = spawnSync("gh", args, { encoding: "utf8", input });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `gh ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function ensureProductionEnvironment(repo: string) {
  const result = spawnSync(
    "gh",
    ["api", "--method", "PUT", `repos/${repo}/environments/production`, "--input", "-"],
    { encoding: "utf8", input: "{}" },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr ||
        result.stdout ||
        `Failed to ensure GitHub production environment for ${repo}`,
    );
  }
}

function setGithubVariable(repo: string, name: string, value: string, environment?: string) {
  const args = ["variable", "set", name, "--repo", repo];
  if (environment) {
    args.push("--env", environment);
  }
  runGh(args, value);
}

function setGithubSecret(repo: string, name: string, value: string, environment: string) {
  runGh(["secret", "set", name, "--repo", repo, "--env", environment], value);
}

const dryRun = process.argv.includes("--dry-run");
const repo = process.env.GITHUB_REPOSITORY?.trim();
if (!repo) {
  process.stderr.write("GITHUB_REPOSITORY is required (or run from a GitHub Actions context).\n");
  process.exit(1);
}

const env = loadRelayEnvFile();
const plan = buildRelayGithubSyncPlan(env);

if (plan.missing.length > 0) {
  process.stderr.write(
    `Missing values in infra/relay/.env: ${plan.missing.join(", ")}\nFill infra/relay/.env first.\n`,
  );
  process.exit(1);
}

if (dryRun) {
  process.stdout.write(`Would sync relay config from infra/relay/.env to ${repo}:\n`);
  for (const entry of plan.repoVariables) {
    process.stdout.write(`  repo variable ${entry.name}\n`);
  }
  for (const entry of plan.productionVariables) {
    process.stdout.write(`  production variable ${entry.name}\n`);
  }
  for (const entry of plan.productionSecrets) {
    process.stdout.write(`  production secret ${entry.name}\n`);
  }
  process.exit(0);
}

ensureProductionEnvironment(repo);

for (const entry of plan.repoVariables) {
  setGithubVariable(repo, entry.name, entry.value);
}
for (const entry of plan.productionVariables) {
  setGithubVariable(repo, entry.name, entry.value, "production");
}
for (const entry of plan.productionSecrets) {
  setGithubSecret(repo, entry.name, entry.value, "production");
}

process.stdout.write(`Synced relay config from infra/relay/.env to GitHub (${repo}).\n`);
