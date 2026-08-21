/**
 * Wire-protocol identifiers for Kata Code Connect relay, clients, and environment servers.
 */
export const WIRE_RELAY_PROVIDER_KIND = "kata_relay" as const;

export const WIRE_MOBILE_CLIENT_ID = "kata-mobile" as const;
export const WIRE_WEB_CLIENT_ID = "kata-web" as const;

export const WIRE_RELAY_PUBLIC_CLIENT_IDS = [WIRE_MOBILE_CLIENT_ID, WIRE_WEB_CLIENT_ID] as const;

export const WIRE_ENVIRONMENT_WELL_KNOWN_PATH = "/.well-known/kata/environment" as const;
export const WIRE_ENVIRONMENT_ISSUER_PREFIX = "kata-env:" as const;

export const WIRE_CONNECT_API_PREFIX = "/api/kata-connect" as const;

/** Clerk JWT template name configured in the Clerk dashboard. */
export const WIRE_RELAY_CLERK_JWT_TEMPLATE = "kata-relay" as const;

/** JWT `aud` claim accepted by the hosted relay worker. */
export const WIRE_RELAY_CLERK_JWT_AUDIENCE = "kata-code-relay" as const;

export const WIRE_RELAY_ENV_LINK_JWT_TYP = "kata-env-link+jwt" as const;
export const WIRE_RELAY_CLOUD_MINT_REQUEST_JWT_TYP = "kata-cloud-mint+jwt" as const;
export const WIRE_RELAY_CLOUD_HEALTH_REQUEST_JWT_TYP = "kata-cloud-health+jwt" as const;
export const WIRE_RELAY_ENV_MINT_RESPONSE_JWT_TYP = "kata-env-mint+jwt" as const;
export const WIRE_RELAY_ENV_HEALTH_RESPONSE_JWT_TYP = "kata-env-health+jwt" as const;
export const WIRE_RELAY_ENV_ACTIVITY_JWT_TYP = "kata-env-activity+jwt" as const;
export const WIRE_RELAY_LINK_CHALLENGE_JWT_TYP = "kata-link-challenge+jwt" as const;
export const WIRE_RELAY_DPOP_ACCESS_JWT_TYP = "kata-relay-dpop-access+jwt" as const;

export function wireEnvironmentIssuer(environmentId: string): string {
  return `${WIRE_ENVIRONMENT_ISSUER_PREFIX}${environmentId}`;
}
