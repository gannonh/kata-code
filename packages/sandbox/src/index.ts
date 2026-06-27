/**
 * @kata-sh/code-sandbox — runtime sandbox-provider SPI + registry.
 *
 * Provider-agnostic. Consumed by `apps/server` (and later Kata Agent). The
 * driver packages (`@kata-sh/code-sandbox-docker`, …) implement `SandboxProvider`.
 */
export * from "./SandboxProviderDriver.ts";
export * from "./SandboxProviderRegistry.ts";
export * from "./descriptor.ts";
