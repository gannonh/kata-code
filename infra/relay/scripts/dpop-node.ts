import * as NodeCrypto from "node:crypto";

import {
  computeDpopAccessTokenHash,
  type DpopPublicJwk,
  normalizeDpopHtu,
} from "@kata-sh/code-shared/dpop";

export interface NodeDpopKeyPair {
  readonly privateKey: NodeCrypto.KeyObject;
  readonly publicJwk: DpopPublicJwk;
}

export function generateNodeDpopKeyPair(): NodeDpopKeyPair {
  const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const publicJwk = publicKey.export({ format: "jwk" }) as DpopPublicJwk;
  return { privateKey, publicJwk };
}

export function signNodeDpopProof(input: {
  readonly method: string;
  readonly url: string;
  readonly iat: number;
  readonly jti: string;
  readonly privateKey: NodeCrypto.KeyObject;
  readonly publicJwk: DpopPublicJwk;
  readonly accessToken?: string;
}): string {
  const normalizedUrl = normalizeDpopHtu(input.url);
  if (normalizedUrl === null) {
    throw new Error("DPoP URL is invalid.");
  }
  const header = Buffer.from(
    JSON.stringify({
      typ: "dpop+jwt",
      alg: "ES256",
      jwk: input.publicJwk,
    }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      htm: input.method.toUpperCase(),
      htu: normalizedUrl,
      jti: input.jti,
      iat: input.iat,
      ...(input.accessToken ? { ath: computeDpopAccessTokenHash(input.accessToken) } : {}),
    }),
  ).toString("base64url");
  const signature = NodeCrypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: input.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${header}.${payload}.${signature}`;
}
