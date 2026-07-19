/**
 * @kata-sh/code-sandbox-vercel — the Vercel Sandbox cloud driver.
 *
 * Implements the frozen `SandboxProvider` SPI against Vercel Sandbox
 * (Firecracker microVMs) via `@vercel/sandbox`. Registered with
 * `SandboxProviderRegistry` by the server layer.
 */
export {
  VercelSandboxProvider,
  vercelConfigDecoder,
  VERCEL_KIND,
  VERCEL_WORKSPACE,
  makeVercelSandboxProvider,
  type VercelSandboxHandleState,
} from "./VercelSandboxProvider.ts";
export {
  VercelSandboxConfig,
  DEFAULT_VERCEL_CONFIG,
  DEFAULT_VERCEL_VCPUS,
  VERCEL_AUTH_ENV_VARS,
  VERCEL_SOURCE_TOKEN_ENV,
  GITHUB_TOKEN_GIT_USERNAME,
  mergeVercelAuthIntoConfig,
} from "./config.ts";
export type { VercelSdk, VercelSandboxInstance, VercelAuthParams } from "./sdk.ts";
export { liveVercelSdk } from "./sdk.ts";
export {
  SANDBOX_HOME,
  KATA_CLI_PACKAGE,
  PROVIDER_CLI_PACKAGES,
  PI_SDK_PIN,
  buildBootstrapScript,
  buildKillServeCommand,
  buildReplaceServeCommand,
  buildServeCommand,
} from "./bootstrap.ts";
