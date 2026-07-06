/**
 * `storedSandboxCredentials` — loads provider credential files captured by the
 * Sign-in flow from `ServerSecretStore` so they are seeded into a sandbox via
 * `buildCredentialSeedArchives`. Each entry maps a provider to a secret name
 * and the in-sandbox relative path the provider reads auth from.
 *
 * @module storedSandboxCredentials
 */
import * as Effect from "effect/Effect";

import { ServerSecretStore } from "../auth/ServerSecretStore.ts";

export interface SandboxCredentialSecret {
  readonly providerId: string;
  readonly secretName: string;
  readonly relativePath: string;
  readonly mode: number;
}

/**
 * Provider credentials stored via the Sign-in flow. `relativePath` is the
 * in-sandbox home-relative path the provider reads auth from (XDG data home
 * for opencode; see the credentialSeed opencode spec for the path rationale).
 */
export const SANDBOX_CREDENTIAL_SECRETS: ReadonlyArray<SandboxCredentialSecret> = [
  {
    providerId: "claude",
    secretName: "sandbox-credential-claude",
    relativePath: ".claude/.credentials.json",
    mode: 0o600,
  },
  {
    providerId: "codex",
    secretName: "sandbox-credential-codex",
    relativePath: ".codex/auth.json",
    mode: 0o600,
  },
  {
    providerId: "opencode",
    secretName: "sandbox-credential-opencode",
    relativePath: ".local/share/opencode/auth.json",
    mode: 0o600,
  },
] as const;

/**
 * Load all stored sandbox credentials present in `ServerSecretStore`. Absent
 * secrets are skipped (the provider starts unauthenticated). Contents are
 * never logged.
 */
export function loadStoredSandboxCredentials(): Effect.Effect<
  ReadonlyArray<{
    readonly relativePath: string;
    readonly content: Uint8Array;
    readonly mode: number;
  }>,
  never,
  ServerSecretStore
> {
  return Effect.gen(function* () {
    const store = yield* ServerSecretStore;
    const loaded: Array<{
      readonly relativePath: string;
      readonly content: Uint8Array;
      readonly mode: number;
    }> = [];
    for (const spec of SANDBOX_CREDENTIAL_SECRETS) {
      const bytes = yield* store
        .get(spec.secretName)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (bytes === null) continue;
      loaded.push({ relativePath: spec.relativePath, content: bytes, mode: spec.mode });
    }
    return loaded;
  });
}
