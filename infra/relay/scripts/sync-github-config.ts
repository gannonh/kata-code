#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Relay bootstrap scripts load dotenv before Effect exists.

import { spawnSync } from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { buildRelayGithubSyncPlan } from "./github-config-map.ts";

const RELAY_ROOT = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const RELAY_ENV_FILE = NodePath.join(RELAY_ROOT, ".env");
const DEFAULT_REPO = "gannonh/kata-code";

function loadRelayEnvFile(path: string): Record<string, string | undefined> {
  if (!NodeFS.existsSync(path)) {
    return {};
  }
  return NodeUtil.parseEnv(NodeFS.readFileSync(path, "utf8"));
}

function runGh(args: ReadonlyArray<string>) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
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
  const args = ["variable", "set", name, "--repo", repo, "--body", value];
  if (environment) {
    args.push("--env", environment);
  }
  runGh(args);
}

function setGithubSecret(repo: string, name: string, value: string, environment: string) {
  runGh(["secret", "set", name, "--repo", repo, "--env", environment, "--body", value]);
}

const dryRun = process.argv.includes("--dry-run");
const repo = process.env.GITHUB_REPOSITORY?.trim() || DEFAULT_REPO;
const env = loadRelayEnvFile(RELAY_ENV_FILE);
const plan = buildRelayGithubSyncPlan(env);

if (plan.missing.length > 0) {
  process.stderr.write(
    `Missing values in ${RELAY_ENV_FILE}: ${plan.missing.join(", ")}\nFill infra/relay/.env first.\n`,
  );
  process.exit(1);
}

if (dryRun) {
  process.stdout.write(`Would sync relay config from ${RELAY_ENV_FILE} to ${repo}:\n`);
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

process.stdout.write(`Synced relay config from ${RELAY_ENV_FILE} to GitHub (${repo}).\n`);
