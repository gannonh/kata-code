import type { ProviderInstanceEnvironment } from "@kata-sh/code-contracts";

const SANDBOX_BOOTSTRAP_TOKEN = "KATACODE_SANDBOX_BOOTSTRAP_TOKEN";

export function mergeProviderInstanceEnvironment(
  environment: ProviderInstanceEnvironment | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const next = { ...baseEnv };
  delete next[SANDBOX_BOOTSTRAP_TOKEN];
  for (const variable of environment ?? []) {
    if (variable.name === SANDBOX_BOOTSTRAP_TOKEN) continue;
    next[variable.name] = variable.value;
  }
  return next;
}
