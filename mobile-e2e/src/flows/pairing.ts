import type { ServePairingInfo } from "../harness/serverStack.ts";

/**
 * Kata-specific pairing inputs for the bearer flow. The Maestro flow
 * `maestro/pairing/bearer-pair.yaml` reads these via `${KC_HOST}` / `${KC_TOKEN}`
 * and types them into the Add-Environment Host + Pairing-code fields.
 */
export function buildPairingMaestroEnv(pairing: ServePairingInfo): Record<string, string> {
  return {
    KC_HOST: pairing.host,
    KC_TOKEN: pairing.token,
  };
}
