export const RELAY_PUBLIC_SMOKE_PATHS = [
  "/health",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
] as const;

export type RelayPublicSmokePath = (typeof RELAY_PUBLIC_SMOKE_PATHS)[number];

export interface RelayPublicSmokeResult {
  readonly path: RelayPublicSmokePath;
  readonly ok: boolean;
  readonly status: number;
}

export interface RelayPublicSmokeSummary {
  readonly relayUrl: string;
  readonly results: ReadonlyArray<RelayPublicSmokeResult>;
  readonly ok: boolean;
}

export function relayPublicSmokeUrl(relayUrl: string, path: RelayPublicSmokePath): string {
  return new URL(path, relayUrl.endsWith("/") ? relayUrl : `${relayUrl}/`).toString();
}

export async function verifyRelayPublicEndpoints(
  relayUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RelayPublicSmokeSummary> {
  const results = await Promise.all(
    RELAY_PUBLIC_SMOKE_PATHS.map(async (path) => {
      const response = await fetchImpl(relayPublicSmokeUrl(relayUrl, path), {
        method: "GET",
        redirect: "manual",
      });
      return {
        path,
        ok: response.ok,
        status: response.status,
      } satisfies RelayPublicSmokeResult;
    }),
  );
  return {
    relayUrl,
    results,
    ok: results.every((result) => result.ok),
  };
}
