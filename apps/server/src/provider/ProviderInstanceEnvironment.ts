import type { ProviderInstanceEnvironment } from "@kata-sh/code-contracts";

const SANDBOX_BOOTSTRAP_TOKEN = "KATACODE_SANDBOX_BOOTSTRAP_TOKEN";

import { expandHomePath } from "../pathExpansion.ts";

export function mergeProviderInstanceEnvironment(
  environment: ProviderInstanceEnvironment | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...baseEnv };
  delete next[SANDBOX_BOOTSTRAP_TOKEN];
  for (const variable of environment ?? []) {
    if (variable.name === SANDBOX_BOOTSTRAP_TOKEN) continue;
    // Child processes do not apply shell expansion to environment values.
    next[variable.name] =
      variable.name === "CODEX_HOME" || variable.name === "CLAUDE_CONFIG_DIR"
        ? expandHomePath(variable.value)
        : variable.value;
  }
  return next;
}
