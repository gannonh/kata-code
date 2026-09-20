import { DEFAULT_HOSTED_APP_ORIGIN } from "./branding.ts";
import { readHashParams } from "./remote.ts";

// Short fragment keys keep the printed authorize link under the width where
// terminals and chat clients wrap it, which was clipping the state and
// challenge when a user copied the link by hand.
const CONNECT_AUTH_STATE_PARAM = "s";
const CONNECT_AUTH_CHALLENGE_PARAM = "c";
const CONNECT_AUTH_PORT_PARAM = "p";
const LEGACY_CONNECT_AUTH_STATE_PARAM = "state";
const LEGACY_CONNECT_AUTH_CHALLENGE_PARAM = "challenge";
const LEGACY_CONNECT_AUTH_PORT_PARAM = "port";
// base64url of 16 and 32 random bytes, per CliTokenManager. Matching the exact
// shape is what makes a clipped link fail closed instead of half-authorizing.
const CONNECT_AUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const CONNECT_AUTH_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CONNECT_LOOPBACK_CALLBACK_PATH = "/callback";

const CONNECT_AUTHORIZE_PATH = "/connect";

/**
 * The CLI prints URLs against this origin and the web bundle uses it to
 * decide whether it is the hosted deployment — the two must agree, so the
 * default lives here.
 */
export const DEFAULT_HOSTED_APP_URL = DEFAULT_HOSTED_APP_ORIGIN;

/**
 * Requested at authorize time by the hosted page and by the CLI's device
 * authorization request; keep both sides on this single definition.
 * `offline_access` asks Clerk for the refresh token the CLI relies on.
 */
export const CONNECT_OAUTH_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

export interface ConnectAuthorizeRequest {
  readonly state: string;
  readonly challenge: string;
  /**
   * The hosted /connect page asks Clerk to redirect the authorization code
   * straight to `http://127.0.0.1:<port>/callback` on the waiting CLI.
   */
  readonly loopbackPort: number;
}

/**
 * The URL the CLI prints for the user to open in a browser. `state` and
 * `code_challenge` ride the fragment so they never reach the hosted app's
 * server or CDN logs; neither is a secret.
 *
 * The CLI routes through the hosted /connect page rather than hitting
 * Clerk's /oauth/authorize directly: a signed-out browser sent straight to
 * /oauth/authorize goes through Clerk's sign-in redirect, which does not
 * reliably preserve the authorize query parameters (state, response_type,
 * code_challenge). The hosted page waits for a Clerk session first, then
 * forwards the request with the parameters intact. Headless hosts use the
 * OAuth device authorization grant instead and never involve this page.
 */
export function buildConnectAuthorizeRequestUrl(input: {
  readonly hostedAppUrl: string;
  readonly state: string;
  readonly challenge: string;
  readonly loopbackPort: number;
}): string {
  const url = new URL(CONNECT_AUTHORIZE_PATH, input.hostedAppUrl);
  url.hash = new URLSearchParams([
    [CONNECT_AUTH_STATE_PARAM, input.state],
    [CONNECT_AUTH_CHALLENGE_PARAM, input.challenge],
    [CONNECT_AUTH_PORT_PARAM, String(input.loopbackPort)],
  ]).toString();
  return url.toString();
}

export function readConnectAuthorizeRequest(url: URL): ConnectAuthorizeRequest | null {
  const params = readHashParams(url);
  // Installed CLIs still emit the long keys, so the hosted app reads both.
  const read = (short: string, legacy: string) =>
    (params.get(short) ?? params.get(legacy))?.trim() ?? "";
  const state = read(CONNECT_AUTH_STATE_PARAM, LEGACY_CONNECT_AUTH_STATE_PARAM);
  const challenge = read(CONNECT_AUTH_CHALLENGE_PARAM, LEGACY_CONNECT_AUTH_CHALLENGE_PARAM);
  const loopbackPort = parseLoopbackPort(
    read(CONNECT_AUTH_PORT_PARAM, LEGACY_CONNECT_AUTH_PORT_PARAM),
  );
  if (
    !CONNECT_AUTH_STATE_PATTERN.test(state) ||
    !CONNECT_AUTH_CHALLENGE_PATTERN.test(challenge) ||
    loopbackPort === null
  ) {
    return null;
  }
  return { state, challenge, loopbackPort };
}

function parseLoopbackPort(value: string): number | null {
  if (!/^\d{1,5}$/.test(value)) {
    return null;
  }
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * Redirect URI for the CLI's local callback listener. Must stay in sync with
 * the redirect URI registered on the Clerk CLI OAuth application.
 */
export function connectLoopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}${CONNECT_LOOPBACK_CALLBACK_PATH}`;
}

export function buildConnectClerkAuthorizeUrl(input: {
  readonly authorizationEndpoint: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: ReadonlyArray<string>;
  readonly state: string;
  readonly challenge: string;
}): string {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
