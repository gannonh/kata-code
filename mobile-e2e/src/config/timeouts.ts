/**
 * Timeouts (ms) for the mobile E2E harness. Tests should fail fast, not hang.
 * Maestro applies its own per-command auto-waits; these bound the orchestrator's
 * process-lifecycle and external-tool steps.
 */
export const MOBILE_E2E_TIMEOUTS = {
  /** Wait for `katacode serve` to print its pairing output (connection string + token). */
  serverStartMs: 60_000,
  /** Wait for `katacode project add <path>` to exit. */
  projectAddMs: 30_000,
  /** Wait for the target simulator to reach a booted state. */
  simulatorBootMs: 120_000,
  /** Single Maestro flow run (launch/pair/smoke). */
  maestroFlowMs: 180_000,
  /** Agent flow run, which waits on a real provider round-trip. */
  agentFlowMs: 300_000,
} as const;
