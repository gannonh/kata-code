export const VERCEL_SANDBOX_SMOKE_AUTH_ERROR =
  "Vercel Sandbox smoke requires VERCEL_TOKEN, VERCEL_ORG_ID, and VERCEL_PROJECT_ID.";

export interface VercelSandboxSmokeAuth {
  readonly token: string;
  readonly teamId: string;
  readonly projectId: string;
}

function readValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function resolveVercelSandboxSmokeAuth(
  environment: Readonly<Record<string, string | undefined>>,
): VercelSandboxSmokeAuth {
  const token = readValue(environment.VERCEL_TOKEN);
  const teamId = readValue(environment.VERCEL_ORG_ID) ?? readValue(environment.VERCEL_TEAM_ID);
  const projectId = readValue(environment.VERCEL_PROJECT_ID);
  if (!token || !teamId || !projectId) {
    throw new Error(VERCEL_SANDBOX_SMOKE_AUTH_ERROR);
  }
  return { token, teamId, projectId };
}
