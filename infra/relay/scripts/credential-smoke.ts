import { createClerkClient } from "@clerk/backend";

export interface CredentialSmokeResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface CredentialSmokeSummary {
  readonly results: ReadonlyArray<CredentialSmokeResult>;
  readonly ok: boolean;
}

export async function verifyCloudflareCredentials(input: {
  readonly accountId: string;
  readonly apiToken: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<CredentialSmokeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.cloudflare.com/client/v4/user/tokens/verify", {
    headers: {
      Authorization: `Bearer ${input.apiToken}`,
      "content-type": "application/json",
    },
  });
  if (!response.ok) {
    return {
      name: "cloudflare",
      ok: false,
      detail: `Token verify failed (${response.status})`,
    };
  }
  const payload = (await response.json()) as {
    readonly success?: boolean;
    readonly result?: { readonly status?: string };
  };
  if (!payload.success) {
    return { name: "cloudflare", ok: false, detail: "Token verify response was not successful" };
  }
  const zonesResponse = await fetchImpl("https://api.cloudflare.com/client/v4/zones?per_page=50", {
    headers: {
      Authorization: `Bearer ${input.apiToken}`,
      "content-type": "application/json",
    },
  });
  if (!zonesResponse.ok) {
    return {
      name: "cloudflare",
      ok: false,
      detail: `Zone list failed (${zonesResponse.status})`,
    };
  }
  const zonesPayload = (await zonesResponse.json()) as {
    readonly success?: boolean;
    readonly result?: ReadonlyArray<{ readonly id?: string; readonly name?: string }>;
  };
  const workerEndpoints = [
    [
      "Workers script settings",
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        input.accountId,
      )}/workers/scripts/alchemy-state-store/settings`,
    ],
    [
      "Workers subdomain",
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        input.accountId,
      )}/workers/subdomain`,
    ],
    [
      "Secrets Store",
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
        input.accountId,
      )}/secrets_store/stores`,
    ],
  ] as const;

  for (const [label, url] of workerEndpoints) {
    const permissionResponse = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${input.apiToken}`,
        "content-type": "application/json",
      },
    });
    if (permissionResponse.status === 401 || permissionResponse.status === 403) {
      return {
        name: "cloudflare",
        ok: false,
        detail: `${label} permission check failed (${permissionResponse.status})`,
      };
    }
  }

  const zoneCount = zonesPayload.result?.length ?? 0;
  return {
    name: "cloudflare",
    ok: true,
    detail: `Token ${payload.result?.status ?? "active"}; account ${input.accountId}; ${zoneCount} zone(s) visible; Workers/Secrets endpoints authorized`,
  };
}

export async function verifyPlanetScaleCredentials(input: {
  readonly organization: string;
  readonly tokenId: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<CredentialSmokeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `https://api.planetscale.com/v1/organizations/${encodeURIComponent(input.organization)}`,
    {
      headers: {
        Authorization: `${input.tokenId}:${input.token}`,
        "content-type": "application/json",
      },
    },
  );
  if (!response.ok) {
    return {
      name: "planetscale",
      ok: false,
      detail: `Organization lookup failed (${response.status})`,
    };
  }
  return {
    name: "planetscale",
    ok: true,
    detail: `Organization ${input.organization} reachable`,
  };
}

export async function verifyAxiomCredentials(input: {
  readonly orgId: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<CredentialSmokeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.axiom.co/v1/datasets", {
    headers: {
      Authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
    },
  });
  if (!response.ok) {
    return {
      name: "axiom",
      ok: false,
      detail: `Dataset list failed (${response.status})`,
    };
  }
  return {
    name: "axiom",
    ok: true,
    detail: `Organization ${input.orgId} token can list datasets`,
  };
}

export async function verifyClerkCredentials(input: {
  readonly secretKey: string;
  readonly smokeUserId: string;
}): Promise<CredentialSmokeResult> {
  try {
    const clerk = createClerkClient({ secretKey: input.secretKey });
    const user = await clerk.users.getUser(input.smokeUserId);
    if (!user.id) {
      return { name: "clerk", ok: false, detail: "Smoke user lookup returned no user id" };
    }
    return { name: "clerk", ok: true, detail: `Smoke user ${user.id} reachable` };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "clerk", ok: false, detail: message };
  }
}

export function verifyApnsCredentials(input: {
  readonly environment: string;
  readonly teamId: string;
  readonly keyId: string;
  readonly bundleId: string;
  readonly privateKey: string;
}): CredentialSmokeResult {
  if (input.environment !== "sandbox" && input.environment !== "production") {
    return {
      name: "apns",
      ok: false,
      detail: "APNS_ENVIRONMENT must be sandbox or production",
    };
  }
  if (!input.privateKey.includes("BEGIN PRIVATE KEY")) {
    return {
      name: "apns",
      ok: false,
      detail: "APNS_PRIVATE_KEY does not look like a PEM private key",
    };
  }
  if (!input.teamId || !input.keyId || !input.bundleId) {
    return { name: "apns", ok: false, detail: "APNS team/key/bundle ids are required" };
  }
  return {
    name: "apns",
    ok: true,
    detail: `APNs ${input.environment} credentials present for ${input.bundleId}`,
  };
}

export async function runCredentialSmoke(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: typeof fetch = fetch,
): Promise<CredentialSmokeSummary> {
  const results = await Promise.all([
    verifyCloudflareCredentials({
      accountId: env.CLOUDFLARE_ACCOUNT_ID ?? "",
      apiToken: env.CLOUDFLARE_API_TOKEN ?? "",
      fetchImpl,
    }),
    verifyPlanetScaleCredentials({
      organization: env.PLANETSCALE_ORGANIZATION ?? "",
      tokenId: env.PLANETSCALE_API_TOKEN_ID ?? "",
      token: env.PLANETSCALE_API_TOKEN ?? "",
      fetchImpl,
    }),
    verifyAxiomCredentials({
      orgId: env.AXIOM_ORG_ID ?? "",
      token: env.AXIOM_TOKEN ?? "",
      fetchImpl,
    }),
    verifyClerkCredentials({
      secretKey: env.CLERK_SECRET_KEY ?? "",
      smokeUserId: env.CLERK_SMOKE_USER_ID ?? "",
    }),
    verifyApnsCredentials({
      environment: env.APNS_ENVIRONMENT ?? "",
      teamId: env.APNS_TEAM_ID ?? "",
      keyId: env.APNS_KEY_ID ?? "",
      bundleId: env.APNS_BUNDLE_ID ?? "",
      privateKey: env.APNS_PRIVATE_KEY ?? "",
    }),
  ]);
  return {
    results,
    ok: results.every((result) => result.ok),
  };
}
