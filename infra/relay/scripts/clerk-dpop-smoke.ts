import { createClerkClient } from "@clerk/backend";
import {
  RelayAccessTokenType,
  RelayDpopTokenExchangeGrantType,
  RelayEnvironmentStatusScope,
  RelayJwtSubjectTokenType,
  RelayWebClientId,
} from "@kata-sh/code-contracts/relay";

import { generateNodeDpopKeyPair, signNodeDpopProof } from "./dpop-node.ts";

export interface MintClerkSmokeTokenInput {
  readonly secretKey: string;
  readonly smokeUserId: string;
  readonly jwtTemplate: string;
}

export interface MintClerkSmokeTokenResult {
  readonly sessionId: string;
  readonly clerkToken: string;
  readonly revoke: () => Promise<void>;
}

export async function mintClerkSmokeToken(
  input: MintClerkSmokeTokenInput,
): Promise<MintClerkSmokeTokenResult> {
  const clerk = createClerkClient({ secretKey: input.secretKey });
  const session = await clerk.sessions.createSession({ userId: input.smokeUserId });
  const tokenResult = await clerk.sessions.getToken(session.id, input.jwtTemplate);
  const clerkToken = tokenResult.jwt;
  if (!clerkToken) {
    await clerk.sessions.revokeSession(session.id);
    throw new Error("Clerk did not return a JWT for the relay smoke template.");
  }
  return {
    sessionId: session.id,
    clerkToken,
    revoke: async () => {
      await clerk.sessions.revokeSession(session.id);
    },
  };
}

export interface ExchangeClerkDpopTokenInput {
  readonly relayUrl: string;
  readonly clerkToken: string;
  readonly fetchImpl?: typeof fetch | undefined;
}

export interface ExchangeClerkDpopTokenResult {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly scope: string;
}

export async function exchangeClerkDpopToken(
  input: ExchangeClerkDpopTokenInput,
): Promise<ExchangeClerkDpopTokenResult> {
  // @effect-diagnostics globalDate:off cryptoRandomUUID:off - DPoP smoke runs outside Effect with wall-clock proofs.
  const relayUrl = input.relayUrl.replace(/\/$/u, "");
  const tokenUrl = `${relayUrl}/v1/client/dpop-token`;
  const keyPair = generateNodeDpopKeyPair();
  const proof = signNodeDpopProof({
    method: "POST",
    url: tokenUrl,
    iat: Math.floor(Date.now() / 1000),
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
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      dpop: proof,
    },
    body,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Relay DPoP token exchange failed (${response.status}): ${detail}`);
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

export async function runClerkDpopSmoke(input: {
  readonly relayUrl: string;
  readonly secretKey: string;
  readonly smokeUserId: string;
  readonly jwtTemplate: string;
  readonly fetchImpl?: typeof fetch | undefined;
}): Promise<ExchangeClerkDpopTokenResult> {
  const minted = await mintClerkSmokeToken({
    secretKey: input.secretKey,
    smokeUserId: input.smokeUserId,
    jwtTemplate: input.jwtTemplate,
  });
  try {
    return await exchangeClerkDpopToken({
      relayUrl: input.relayUrl,
      clerkToken: minted.clerkToken,
      fetchImpl: input.fetchImpl,
    });
  } finally {
    await minted.revoke();
  }
}

if (import.meta.main) {
  const relayUrl = process.env.RELAY_URL?.trim();
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  const smokeUserId = process.env.CLERK_SMOKE_USER_ID?.trim();
  const jwtTemplate = process.env.CLERK_JWT_TEMPLATE?.trim();
  if (!relayUrl || !secretKey || !smokeUserId || !jwtTemplate) {
    process.stderr.write(
      "Missing required environment variables: RELAY_URL, CLERK_SECRET_KEY, CLERK_SMOKE_USER_ID, CLERK_JWT_TEMPLATE.\n",
    );
    process.exit(1);
  }
  runClerkDpopSmoke({ relayUrl, secretKey, smokeUserId, jwtTemplate })
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
