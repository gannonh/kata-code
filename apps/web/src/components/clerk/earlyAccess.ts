import type { ClerkProviderProps } from "@clerk/react";

import { resolveClerkSignInProps, type ClerkSignInProps } from "./authRedirect";

// Kata fork delta (KAT-3512): Kata Code Connect stays invite-gated. Upstream T3
// removed its waitlist at GA; Kata keeps a Clerk waitlist labelled "early
// access" plus a separate sign-in path for approved users.

/** Clerk copy overrides so every Clerk-rendered waitlist prompt says "early access". */
export const clerkEarlyAccessLocalization = {
  waitlist: {
    start: {
      title: "Request early access",
      subtitle:
        "Enter your email and we'll let you know when your Kata Code Connect access is ready.",
      formButton: "Request early access",
      actionText: "Already approved?",
      actionLink: "Sign in",
    },
    success: {
      title: "You requested early access",
      subtitle: "We'll email you when your Kata Code Connect access is ready.",
      message: "Redirecting…",
    },
  },
  signIn: {
    start: {
      actionText__join_waitlist: "Not approved yet?",
      actionLink__join_waitlist: "Request early access",
    },
  },
  signUp: {
    restrictedAccess: {
      subtitleWaitlist:
        "Kata Code Connect is in early access. Request access and we'll email you when it's ready.",
      blockButton__joinWaitlist: "Request early access",
    },
  },
} satisfies NonNullable<ClerkProviderProps["localization"]>;

interface T3ConnectAuthClerk {
  readonly openWaitlist: () => void;
  readonly openSignIn: (props: ClerkSignInProps) => void;
}

export function openT3ConnectEarlyAccess(clerk: T3ConnectAuthClerk): void {
  clerk.openWaitlist();
}

export function openT3ConnectSignIn(
  clerk: T3ConnectAuthClerk,
  href: string,
  isElectron: boolean,
): void {
  clerk.openSignIn(resolveClerkSignInProps(href, isElectron));
}
