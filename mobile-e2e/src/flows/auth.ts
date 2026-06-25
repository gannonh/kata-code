import type { ResolvedCredentials } from "../harness/prereqs.ts";

/**
 * Maestro variables for `maestro/auth/clerk-connect.yaml`. Consumes the email
 * the prereq gate already validated, rather than re-reading process.env.
 *
 * Mobile sign-in is a native auth modal (`NativeClerk.presentAuth`); whether
 * Maestro can drive it is a Studio discovery item, so this flow's green runtime
 * pass is deferred to a maintainer.
 */
export function buildAuthMaestroEnv(credentials: ResolvedCredentials): Record<string, string> {
  if (!credentials.googleEmail) {
    // The prereq gate guarantees this when @auth is selected; reaching here is
    // a wiring bug, so fail loud rather than silently emitting empty vars.
    throw new Error(
      "buildAuthMaestroEnv called without a resolved Google test-user email; @auth requires the clerk + google credential groups.",
    );
  }
  return { KC_GOOGLE_EMAIL: credentials.googleEmail };
}
