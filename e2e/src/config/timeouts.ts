/* oxlint-disable kata-code/no-global-process-runtime -- E2E timeout knobs are read from process.env. */

function readPositiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Shared local E2E timeout budget. Override individual knobs via KATACODE_E2E_* env vars. */
export const E2E_TIMEOUTS = {
  devStackMs: readPositiveIntEnv("KATACODE_E2E_DEV_STACK_TIMEOUT_MS", 30_000),
  electronWindowMs: readPositiveIntEnv("KATACODE_E2E_ELECTRON_WINDOW_TIMEOUT_MS", 30_000),
  testMs: readPositiveIntEnv("KATACODE_E2E_TEST_TIMEOUT_MS", 90_000),
  agentTestMs: readPositiveIntEnv("KATACODE_E2E_AGENT_TEST_TIMEOUT_MS", 120_000),
  setupMs: readPositiveIntEnv("KATACODE_E2E_SETUP_TIMEOUT_MS", 20_000),
  assertionMs: readPositiveIntEnv("KATACODE_E2E_ASSERTION_TIMEOUT_MS", 10_000),
  authMs: readPositiveIntEnv("KATACODE_E2E_AUTH_TIMEOUT_MS", 30_000),
  agentReplyMs: readPositiveIntEnv("KATACODE_E2E_AGENT_REPLY_TIMEOUT_MS", 90_000),
  pairingMs: readPositiveIntEnv("KATACODE_E2E_PAIRING_TIMEOUT_MS", 20_000),
} as const;
