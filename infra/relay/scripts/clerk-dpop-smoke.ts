#!/usr/bin/env node

import { createClerkClient } from "@clerk/backend";
import {
  RelayAccessTokenType,
  RelayDpopTokenExchangeGrantType,
  RelayEnvironmentStatusScope,
  RelayJwtSubjectTokenType,
  RelayWebClientId,
} from "@kata-sh/code-contracts/relay";

import { clerkFrontendApiUrlFromPublishableKey } from "@kata-sh/code-shared/relayAuth";

import { generateNodeDpopKeyPair, signNodeDpopProof } from "./dpop-node.ts";

const ClerkFrontendApiVersion = "2025-11-10";

export interface ExchangeClerkDpopTokenInput {
  readonly relayUrl: string;
  readonly clerkToken: string;
  readonly fetchImpl?: typeof fetch;
}

export interface ExchangeClerkDpopTokenResult {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly scope: string;
}

export async function exchangeClerkDpopToken(
  input: ExchangeClerkDpopTokenInput,
): Promise<ExchangeClerkDpopTokenResult> {
  const relayUrl = input.relayUrl.replace(/\/$/u, "");
  const tokenUrl = `${relayUrl}/v1/client/dpop-token`;
  const keyPair = generateNodeDpopKeyPair();
  // @effect-diagnostics globalDate:off cryptoRandomUUID:off - Smoke runs use wall-clock DPoP proofs.
  const proof = signNodeDpopProof({
    method: "POST",
    url: tokenUrl,
    iat: Math.floor(Date.now() / 1_000),
    jti: crypto.randomUUID(),
    privateKey: keyPair.privateKey,
    publicJwk: keyPair.publicJwk,
  });
  const body = new URLSearchParams({
    grant_type: RelayDpopTokenExchangeGrantType,
    subject_token: input.clerkToken,
    subject_token_type: RelayJwtSubjectTokenType,
    requested_token_type: RelayAccessTokenType,
    resource: relayUrl,
    scope: RelayEnvironmentStatusScope,
    client_id: RelayWebClientId,
  });
  const response = await (input.fetchImpl ?? fetch)(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", dpop: proof },
    body,
  });
  if (!response.ok) {
    throw new Error(
      `Relay DPoP token exchange failed (${response.status}): ${await response.text()}`,
    );
  }
  const payload = (await response.json()) as {
    readonly access_token?: string;
    readonly expires_in?: number;
    readonly scope?: string;
  };
  if (!payload.access_token || !payload.expires_in || !payload.scope) {
    throw new Error("Relay DPoP token exchange returned an incomplete response.");
  }
  return {
    accessToken: payload.access_token,
    expiresIn: payload.expires_in,
    scope: payload.scope,
  };
}

export interface RedeemSignInTicketInput {
  readonly frontendApiUrl: string;
  readonly ticket: string;
  readonly jwtTemplate: string;
  readonly fetchImpl?: typeof fetch;
}

export interface RedeemSignInTicketResult {
  readonly sessionId: string;
  readonly jwt: string;
}

/**
 * Backend API `POST /v1/sessions` only works on development instances, so the smoke test signs
 * in through the Frontend API with a Backend API sign-in token, which production accepts.
 */
export async function redeemSignInTicket(
  input: RedeemSignInTicketInput,
): Promise<RedeemSignInTicketResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const query = `__clerk_api_version=${ClerkFrontendApiVersion}&_is_native=1`;
  const signInResponse = await fetchImpl(`${input.frontendApiUrl}/v1/client/sign_ins?${query}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ strategy: "ticket", ticket: input.ticket }),
  });
  const clientToken = signInResponse.headers.get("authorization");
  const signIn = (await signInResponse.json()) as {
    readonly response?: { readonly status?: string; readonly created_session_id?: string };
  };
  const sessionId = signIn.response?.created_session_id;
  if (!signInResponse.ok || signIn.response?.status !== "complete" || !sessionId || !clientToken) {
    throw new Error(`Clerk sign-in ticket was not accepted (${signInResponse.status}).`);
  }
  const tokenResponse = await fetchImpl(
    `${input.frontendApiUrl}/v1/client/sessions/${sessionId}/tokens/${input.jwtTemplate}?${query}`,
    { method: "POST", headers: { authorization: clientToken } },
  );
  const token = (await tokenResponse.json()) as { readonly jwt?: string };
  if (!tokenResponse.ok || !token.jwt) {
    throw new Error(
      `Clerk did not return a JWT for the relay smoke template (${tokenResponse.status}).`,
    );
  }
  return { sessionId, jwt: token.jwt };
}

async function runClerkDpopSmoke(input: {
  readonly relayUrl: string;
  readonly secretKey: string;
  readonly publishableKey: string;
  readonly smokeUserId: string;
  readonly jwtTemplate: string;
}): Promise<ExchangeClerkDpopTokenResult> {
  const clerk = createClerkClient({ secretKey: input.secretKey });
  const signInToken = await clerk.signInTokens.createSignInToken({
    userId: input.smokeUserId,
    expiresInSeconds: 60,
  });
  const session = await redeemSignInTicket({
    frontendApiUrl: clerkFrontendApiUrlFromPublishableKey(input.publishableKey),
    ticket: signInToken.token,
    jwtTemplate: input.jwtTemplate,
  });
  try {
    return await exchangeClerkDpopToken({ relayUrl: input.relayUrl, clerkToken: session.jwt });
  } finally {
    await clerk.sessions.revokeSession(session.sessionId);
  }
}

if (import.meta.main) {
  const relayUrl = process.env.RELAY_URL?.trim();
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY?.trim();
  const smokeUserId = process.env.CLERK_SMOKE_USER_ID?.trim();
  const jwtTemplate = process.env.CLERK_JWT_TEMPLATE?.trim();
  if (!relayUrl || !secretKey || !publishableKey || !smokeUserId || !jwtTemplate) {
    process.stderr.write(
      "Missing required environment variables: RELAY_URL, CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, CLERK_SMOKE_USER_ID, CLERK_JWT_TEMPLATE.\n",
    );
    process.exit(1);
  }
  runClerkDpopSmoke({ relayUrl, secretKey, publishableKey, smokeUserId, jwtTemplate })
    .then((result) => {
      process.stdout.write(
        `Relay Clerk DPoP smoke passed (scope=${result.scope}, expires_in=${result.expiresIn}).\n`,
      );
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Relay Clerk DPoP smoke failed: ${message}\n`);
      process.exit(1);
    });
}
