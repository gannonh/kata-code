/**
 * Upstream wire-protocol identifiers retained for relay/mobile compatibility until Phase 2.
 * See FORK.md divergence log and ADR 0002 before renaming these values.
 */
export const WIRE_RELAY_PROVIDER_KIND = "t3_relay" as const;

export const WIRE_MOBILE_CLIENT_ID = "t3-mobile" as const;
export const WIRE_WEB_CLIENT_ID = "t3-web" as const;

export const WIRE_RELAY_PUBLIC_CLIENT_IDS = [WIRE_MOBILE_CLIENT_ID, WIRE_WEB_CLIENT_ID] as const;

export const WIRE_ENVIRONMENT_WELL_KNOWN_PATH = "/.well-known/t3/environment" as const;

export const WIRE_T3_CONNECT_API_PREFIX = "/api/t3-connect" as const;
