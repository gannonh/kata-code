import { clerkFrontendApiHostnameFromPublishableKey } from "@kata-sh/code-shared/relayAuth";

/**
 * Associated domains for Clerk passkeys and universal links, derived from the
 * Clerk instance the build signs in against. Without a publishable key there
 * is no Clerk domain to claim, so the build declares none.
 */
export function clerkIosAssociatedDomains(
  publishableKey: string | undefined,
): string[] | undefined {
  const key = publishableKey?.trim();
  if (!key) {
    return undefined;
  }
  const hostname = clerkFrontendApiHostnameFromPublishableKey(key);
  return [`applinks:${hostname}`, `webcredentials:${hostname}`];
}
