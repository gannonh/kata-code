/**
 * Connect registration helpers for sandbox sessions: HTTP JSON helpers,
 * Connect auth token resolution, relay link registration, and pairing.
 *
 * @module sandboxConnect
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
// @effect-diagnostics nodeBuiltinImport:on
import * as os from "node:os";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  AuthAccessTokenResult,
  AuthAccessTokenType,
  AuthAdministrativeScopes,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
  type ExecutionEnvironmentDescriptor,
  ExecutionEnvironmentDescriptor as ExecutionEnvironmentDescriptorSchema,
  type SandboxStartSessionInput,
} from "@kata-sh/code-contracts";
import { resolveDefaultKatacodeHome } from "@kata-sh/code-shared/branding";
import { encodeOAuthScope } from "@kata-sh/code-shared/oauthScope";
import { SandboxRpcError } from "@kata-sh/code-contracts/sandboxRpc";
import {
  type RelayEnvironmentConfigRequest,
  RelayEnvironmentLinkChallengeResponse,
  RelayEnvironmentLinkResponse,
  RelayEnvironmentLeaseRenewalResponse,
  type RelayLinkProofRequest,
  type RelayManagedEndpointProviderKind,
} from "@kata-sh/code-contracts/relay";
import { WIRE_ENVIRONMENT_WELL_KNOWN_PATH } from "@kata-sh/code-contracts/wireIdentity";
import * as CliTokenManager from "../cloud/CliTokenManager.ts";
import { cloudCliOAuthConfig, relayUrlConfig } from "../cloud/publicConfig.ts";

const SANDBOX_FETCH_TIMEOUT_MS = 30_000;

/** Append a user-facing hint when a Connect registration error is caused by
 *  a stale or invalid relay bearer token (e.g. after a relay redeploy). The
 *  desktop UI passes a Clerk session token as `connectAuthToken`; signing out
 *  and back in refreshes it. */
export function withConnectAuthHint(message: string): string {
  if (/invalid_bearer|RelayAuthInvalidError|auth_invalid/i.test(message)) {
    return `${message} — Sign out and back in to Kata Code Connect to refresh your session, then retry.`;
  }
  return message;
}

export function errorToMessage(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

async function readResponseBody(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null && "message" in parsed) {
      return String((parsed as { message: unknown }).message);
    }
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      const error = String((parsed as { error: unknown }).error);
      const description =
        "error_description" in parsed
          ? String((parsed as { error_description: unknown }).error_description)
          : "";
      return description ? `${error}: ${description}` : error;
    }
  } catch {
    // The raw response text is more useful than a JSON parse failure here.
  }
  return text;
}

async function fetchAndDecodeJson<S extends Schema.Decoder<unknown>>(
  schema: S,
  url: string,
  init?: RequestInit,
): Promise<S["Type"]> {
  // Bound every Connect/container fetch so a hung network call fails loudly
  // instead of leaving startSession/testConnection pending indefinitely.
  // @effect-diagnostics-next-line globalFetch:off - probes another Kata server endpoint from the sandbox orchestrator.
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(SANDBOX_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url} failed: ${await readResponseBody(response)}`);
  }
  return Schema.decodeUnknownSync(schema)(await response.json());
}

export function fetchJson<S extends Schema.Decoder<unknown>>(
  schema: S,
  url: string,
  init?: RequestInit,
): Effect.Effect<S["Type"], SandboxRpcError> {
  return Effect.tryPromise({
    try: () => fetchAndDecodeJson(schema, url, init),
    catch: (cause) =>
      new SandboxRpcError({
        reason: "connect-failed",
        message: errorToMessage(cause),
      }),
  });
}

export function postJson<S extends Schema.Decoder<unknown>>(
  schema: S,
  url: string,
  payload: unknown,
  bearerToken?: string,
): Effect.Effect<S["Type"], SandboxRpcError> {
  return fetchJson(schema, url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
}

export function renewSandboxConnectLease(input: {
  readonly relayUrl: string;
  readonly environmentId: string;
  readonly bearerToken: string;
}) {
  return postJson(
    RelayEnvironmentLeaseRenewalResponse,
    `${input.relayUrl}/v1/client/environment-links/${encodeURIComponent(input.environmentId)}/lease`,
    {},
    input.bearerToken,
  );
}

export function deleteJson<S extends Schema.Decoder<unknown>>(
  schema: S,
  url: string,
  bearerToken?: string,
): Effect.Effect<S["Type"], SandboxRpcError> {
  return fetchJson(schema, url, {
    method: "DELETE",
    headers: bearerToken ? { authorization: `Bearer ${bearerToken}` } : {},
  });
}

function exchangeBootstrapToken(input: {
  readonly httpBaseUrl: string;
  readonly bootstrapToken: string;
}): Effect.Effect<AuthAccessTokenResult, SandboxRpcError> {
  const body = new URLSearchParams({
    grant_type: AuthTokenExchangeGrantType,
    subject_token: input.bootstrapToken,
    subject_token_type: AuthEnvironmentBootstrapTokenType,
    requested_token_type: AuthAccessTokenType,
    scope: encodeOAuthScope(AuthAdministrativeScopes),
    client_label: "Kata Code sandbox environment",
    client_device_type: "desktop",
  });
  return fetchJson(AuthAccessTokenResult, `${input.httpBaseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

type ConnectAuthTokenPreference = "provided-first" | "stored-first";

const CONNECT_TOKEN_REFRESH_EARLY_MS = 5 * 60 * 1_000;

const ProductionCliToken = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAtEpochMs: Schema.Number,
});
type ProductionCliToken = typeof ProductionCliToken.Type;

const ProductionCliTokenJson = Schema.fromJsonString(ProductionCliToken);
const decodeProductionCliToken = Schema.decodeUnknownEffect(ProductionCliTokenJson);
const encodeProductionCliToken = Schema.encodeEffect(ProductionCliTokenJson);

const ConnectOAuthTokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.Number,
  token_type: Schema.String,
});

export function connectAuthTokenPreferenceForEndpoint(
  endpointProviderKind: RelayManagedEndpointProviderKind,
): ConnectAuthTokenPreference {
  return endpointProviderKind === "cloudflare_tunnel" ? "provided-first" : "stored-first";
}

function readStoredConnectAuthToken(): Effect.Effect<
  Option.Option<{ readonly accessToken: string }>,
  SandboxRpcError,
  CliTokenManager.CloudCliTokenManager
> {
  // The CLI token manager is auto-refreshable and reads from the runtime's
  // secrets directory. In dev mode (VITE_DEV_SERVER_URL set) that's
  // ~/.katacode/dev/secrets/; `npx @kata-sh/code-cli connect login` (run
  // without --dev-url) stores to ~/.katacode/userdata/secrets/, so also check
  // the production path before falling through to the desktop session token.
  return Effect.flatMap(CliTokenManager.CloudCliTokenManager, (tokens) => tokens.getExisting).pipe(
    Effect.orElseSucceed(() => Option.none<{ readonly accessToken: string }>()),
    Effect.flatMap((cliToken) => {
      if (Option.isSome(cliToken)) return Effect.succeed(Option.some(cliToken.value));
      return readProductionCliToken();
    }),
  );
}

export function resolveConnectAuthToken(
  connectAuthToken: SandboxStartSessionInput["connectAuthToken"],
  preference: ConnectAuthTokenPreference,
): Effect.Effect<string, SandboxRpcError, CliTokenManager.CloudCliTokenManager> {
  // Loopback/Docker registration happens immediately after local container
  // start, so prefer the freshly supplied desktop token when available. Public
  // Vercel registration can happen minutes after the UI request starts, so keep
  // using the refreshable stored CLI OAuth token first there.
  if (preference === "provided-first" && connectAuthToken) {
    return Effect.succeed(connectAuthToken);
  }
  return readStoredConnectAuthToken().pipe(
    Effect.flatMap((storedToken) => {
      if (Option.isSome(storedToken)) return Effect.succeed(storedToken.value.accessToken);
      if (connectAuthToken) return Effect.succeed(connectAuthToken);
      return Effect.fail(
        new SandboxRpcError({
          reason: "connect-failed",
          message:
            "No Kata Code Connect credential found. Run `npx @kata-sh/code-cli connect login` to authorize, or sign in to Kata Code Connect from the desktop app.",
        }),
      );
    }),
  );
}

/**
 * Fallback: read the CLI OAuth token from the production secrets directory
 * (~/.katacode/userdata/secrets/cloud-cli-oauth-token.bin). The
 * CliTokenManager's ServerSecretStore points at ~/.katacode/dev/secrets/
 * when the server runs in dev mode (VITE_DEV_SERVER_URL set).
 * `npx @kata-sh/code-cli connect login` (run without --dev-url) stores
 * to userdata/secrets/, so the managed path sees no token and silently
 * falls through to the short-lived Clerk JWT (60 s TTL), which expires
 * during Vercel sandbox provisioning (2-3 min). This fallback bridges
 * the directory mismatch and refreshes the production token before use.
 */
function productionCliTokenPath(): string {
  return NodePath.join(
    resolveDefaultKatacodeHome(os.homedir()),
    "userdata",
    "secrets",
    "cloud-cli-oauth-token.bin",
  );
}

function refreshProductionCliToken(
  token: ProductionCliToken,
): Effect.Effect<ProductionCliToken, SandboxRpcError> {
  return Effect.gen(function* () {
    const metadata = yield* cloudCliOAuthConfig.pipe(
      Effect.mapError(
        (cause) =>
          new SandboxRpcError({
            reason: "connect-failed",
            message: `Kata Code Connect OAuth config is unavailable: ${String(cause)}`,
          }),
      ),
    );
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
      client_id: metadata.clientId,
    });
    const response = yield* fetchJson(ConnectOAuthTokenResponse, metadata.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const now = yield* Clock.currentTimeMillis;
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? token.refreshToken,
      expiresAtEpochMs: now + response.expires_in * 1_000,
    } satisfies ProductionCliToken;
  });
}

// @effect-diagnostics-next-line effect(nodeBuiltinImport):off - Direct filesystem read for production token fallback.
function readProductionCliToken(): Effect.Effect<
  Option.Option<{ readonly accessToken: string }>,
  SandboxRpcError
> {
  return Effect.gen(function* () {
    const tokenPath = productionCliTokenPath();
    const raw = yield* Effect.sync(() => {
      try {
        return NodeFS.readFileSync(tokenPath, "utf8");
      } catch {
        return null as string | null;
      }
    });
    if (raw === null) return Option.none();
    const decoded = yield* decodeProductionCliToken(raw).pipe(
      Effect.mapError(
        (cause) =>
          new SandboxRpcError({
            reason: "connect-failed",
            message: `Stored Kata Code Connect CLI credential is unreadable. Run \`npx @kata-sh/code-cli connect login\`, then retry. ${errorToMessage(cause)}`,
          }),
      ),
    );
    const now = yield* Clock.currentTimeMillis;
    if (decoded.expiresAtEpochMs - CONNECT_TOKEN_REFRESH_EARLY_MS > now) {
      return Option.some({ accessToken: decoded.accessToken });
    }
    const refreshed = yield* refreshProductionCliToken(decoded).pipe(
      Effect.mapError(
        (cause) =>
          new SandboxRpcError({
            reason: "connect-failed",
            message: `Stored Kata Code Connect CLI credential is expired and refresh failed. Run \`npx @kata-sh/code-cli connect login\`, then retry. ${errorToMessage(cause)}`,
          }),
      ),
    );
    const encoded = yield* encodeProductionCliToken(refreshed).pipe(
      Effect.mapError(
        (cause) =>
          new SandboxRpcError({
            reason: "connect-failed",
            message: `Could not encode refreshed Kata Code Connect CLI credential. ${errorToMessage(cause)}`,
          }),
      ),
    );
    yield* Effect.try({
      try: () => {
        NodeFS.writeFileSync(tokenPath, encoded);
        NodeFS.chmodSync(tokenPath, 0o600);
      },
      catch: (cause) =>
        new SandboxRpcError({
          reason: "connect-failed",
          message: `Could not persist refreshed Kata Code Connect CLI credential. ${errorToMessage(cause)}`,
        }),
    });
    return Option.some({ accessToken: refreshed.accessToken });
  });
}

export function registerSandboxWithConnect(input: {
  readonly httpBaseUrl: string;
  readonly bootstrapToken: string;
  readonly connectAuthToken: SandboxStartSessionInput["connectAuthToken"];
  /** Relay endpoint provider kind: `cloudflare_tunnel` for loopback, `manual` for public. */
  readonly endpointProviderKind: RelayManagedEndpointProviderKind;
  /** Origin the relay reaches the sandbox at (loopback: 127.0.0.1 + port; public: hostname + 443). */
  readonly origin: { readonly localHttpHost: string; readonly localHttpPort: number };
}): Effect.Effect<
  {
    readonly descriptor: ExecutionEnvironmentDescriptor;
    readonly adminAccessToken: string;
    readonly relay?: { readonly relayUrl: string; readonly bearerToken: string } | null;
  },
  SandboxRpcError,
  CliTokenManager.CloudCliTokenManager
> {
  return Effect.gen(function* () {
    const relayUrl = yield* relayUrlConfig.pipe(
      Effect.mapError(
        (cause) =>
          new SandboxRpcError({
            reason: "connect-failed",
            message: `KATACODE_RELAY_URL is not configured for sandbox Connect registration: ${String(cause)}`,
          }),
      ),
    );
    const bearerToken = yield* resolveConnectAuthToken(
      input.connectAuthToken,
      connectAuthTokenPreferenceForEndpoint(input.endpointProviderKind),
    );
    const session = yield* exchangeBootstrapToken(input);
    const descriptor = yield* fetchJson(
      ExecutionEnvironmentDescriptorSchema,
      `${input.httpBaseUrl}${WIRE_ENVIRONMENT_WELL_KNOWN_PATH}`,
    );
    const endpoint = {
      httpBaseUrl: input.httpBaseUrl,
      wsBaseUrl: input.httpBaseUrl.replace(/^http/u, "ws"),
      providerKind: input.endpointProviderKind,
    };
    const challenge = yield* postJson(
      RelayEnvironmentLinkChallengeResponse,
      `${relayUrl}/v1/client/environment-link-challenges`,
      {
        notificationsEnabled: true,
        liveActivitiesEnabled: true,
        managedTunnelsEnabled: true,
      },
      bearerToken,
    );
    const proofRequest: RelayLinkProofRequest = {
      challenge: challenge.challenge,
      relayIssuer: relayUrl,
      endpoint,
      origin: {
        localHttpHost: input.origin.localHttpHost,
        localHttpPort: input.origin.localHttpPort,
      },
    };
    const proof = yield* postJson(
      Schema.String,
      `${input.httpBaseUrl}/api/connect/link-proof`,
      proofRequest,
      session.access_token,
    );
    const link = yield* postJson(
      RelayEnvironmentLinkResponse,
      `${relayUrl}/v1/client/environment-links`,
      {
        proof,
        notificationsEnabled: true,
        liveActivitiesEnabled: true,
        managedTunnelsEnabled: true,
      },
      bearerToken,
    );
    if (link.environmentId !== descriptor.environmentId) {
      return yield* new SandboxRpcError({
        reason: "connect-failed",
        message: "Relay returned credentials for a different sandbox environment.",
      });
    }
    const relayConfig: RelayEnvironmentConfigRequest = {
      relayUrl,
      relayIssuer: link.relayIssuer,
      cloudUserId: link.cloudUserId,
      environmentCredential: link.environmentCredential,
      cloudMintPublicKey: link.cloudMintPublicKey,
      endpointRuntime: link.endpointRuntime,
    };
    yield* postJson(
      RelayConfigResponse,
      `${input.httpBaseUrl}/api/connect/relay-config`,
      relayConfig,
      session.access_token,
    );
    return {
      descriptor,
      adminAccessToken: session.access_token,
      relay: { relayUrl, bearerToken },
    };
  });
}

/** Wire shape of the pairing-token response. Decoded from raw JSON, so
 * `expiresAt` stays a string here (the full `AuthPairingCredentialResult`
 * schema expects a decoded DateTime). Only `credential` is used. */
const SandboxPairingCredentialWire = Schema.Struct({
  credential: Schema.String,
});

/** Mint a fresh pairing credential from the in-container server. The desktop
 * bootstrap token is single-use and is consumed by Connect registration, so
 * the deploying client needs its own credential to save the sandbox as an
 * environment. */
export function issueSandboxPairingCredential(input: {
  readonly httpBaseUrl: string;
  readonly adminAccessToken: string;
}): Effect.Effect<string, SandboxRpcError> {
  return postJson(
    SandboxPairingCredentialWire,
    `${input.httpBaseUrl}/api/auth/pairing-token`,
    { label: "Deploying desktop" },
    input.adminAccessToken,
  ).pipe(Effect.map((credential) => credential.credential));
}

/** Re-probe all providers on the sandbox server via the `/api/providers/refresh`
 *  HTTP endpoint. Called after credentials are seeded via copyInto so the
 *  sandbox server re-probes with auth in place. The initial boot probe may
 *  have fired before credentials were in the container home. */
export function refreshSandboxProviders(input: {
  readonly httpBaseUrl: string;
  readonly adminAccessToken: string;
}): Effect.Effect<void, SandboxRpcError> {
  // Best-effort: a 200 with any body is a successful refresh. The refreshed
  // provider statuses flow to clients via the WS serverConfig stream.
  return fetchJson(Schema.Unknown, `${input.httpBaseUrl}/api/providers/refresh`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.adminAccessToken}` },
  }).pipe(Effect.asVoid);
}

const RelayConfigResponse = Schema.Struct({ ok: Schema.Boolean });
