import {
  formatMissingPrerequisiteError,
  readClerkPrerequisites,
  readGoogleTestUserEmail,
  readGoogleTestUserPrerequisites,
} from "../harness/env.ts";

/**
 * Fail-loud gate for the Clerk Connect sign-in flow. Aggregates the missing
 * Clerk + Google test-user prerequisites so the @auth run names every gap at once.
 */
export function assertClerkConnectPrereqs(): { readonly email: string } {
  const missing: string[] = [];
  const clerk = readClerkPrerequisites();
  if (!clerk.ok) {
    missing.push(...clerk.missing);
  }
  const google = readGoogleTestUserPrerequisites();
  if (!google.ok) {
    missing.push(...google.missing);
  }
  if (missing.length > 0) {
    throw new Error(formatMissingPrerequisiteError("Clerk Connect sign-in", missing));
  }
  return { email: readGoogleTestUserEmail() };
}

/**
 * Maestro variables for `maestro/auth/clerk-connect.yaml`. Mobile sign-in is a
 * native auth modal (`NativeClerk.presentAuth`); whether Maestro can drive it is a
 * Studio discovery item, so this flow's green runtime pass is deferred to a maintainer.
 */
export function buildAuthMaestroEnv(): Record<string, string> {
  const { email } = assertClerkConnectPrereqs();
  return { KC_GOOGLE_EMAIL: email };
}
