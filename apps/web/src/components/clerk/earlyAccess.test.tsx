import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { SidebarProvider } from "../ui/sidebar";
import {
  clerkEarlyAccessLocalization,
  openT3ConnectEarlyAccess,
  openT3ConnectSignIn,
} from "./earlyAccess";
import { T3ConnectSignedOutMenu } from "./T3ConnectSidebarSignIn";

function fakeClerk() {
  return { openWaitlist: vi.fn(), openSignIn: vi.fn() };
}

describe("Kata Code Connect early access", () => {
  it("opens the Clerk waitlist instead of sign-up", () => {
    const clerk = fakeClerk();

    openT3ConnectEarlyAccess(clerk);

    expect(clerk.openWaitlist).toHaveBeenCalledExactlyOnceWith();
    expect(clerk.openSignIn).not.toHaveBeenCalled();
  });

  it("keeps a separate sign-in path that returns to the current page", () => {
    const clerk = fakeClerk();
    const href = "https://app.kata.sh/settings/general";

    openT3ConnectSignIn(clerk, href, false);

    expect(clerk.openSignIn).toHaveBeenCalledExactlyOnceWith({
      forceRedirectUrl: href,
      signUpForceRedirectUrl: href,
    });
    expect(clerk.openWaitlist).not.toHaveBeenCalled();
  });

  it("offers early access and sign-in as separate signed-out sidebar actions", () => {
    const markup = renderToStaticMarkup(
      <SidebarProvider>
        <T3ConnectSignedOutMenu onRequestEarlyAccess={vi.fn()} onSignIn={vi.fn()} />
      </SidebarProvider>,
    );

    expect(markup).toContain("Request early access");
    expect(markup).toContain("Sign in to Kata Code Connect");
  });

  it("labels every Clerk waitlist prompt as early access", () => {
    expect(clerkEarlyAccessLocalization.waitlist.start.title).toBe("Request early access");
    expect(clerkEarlyAccessLocalization.waitlist.start.formButton).toBe("Request early access");
    expect(clerkEarlyAccessLocalization.waitlist.success.title).toBe("You requested early access");
    expect(clerkEarlyAccessLocalization.signIn.start.actionLink__join_waitlist).toBe(
      "Request early access",
    );
    expect(clerkEarlyAccessLocalization.signUp.restrictedAccess.blockButton__joinWaitlist).toBe(
      "Request early access",
    );
  });
});
