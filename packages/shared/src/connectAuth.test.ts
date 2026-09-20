import { describe, expect, it } from "vite-plus/test";

import {
  buildConnectAuthorizeRequestUrl,
  buildConnectClerkAuthorizeUrl,
  connectLoopbackRedirectUri,
  readConnectAuthorizeRequest,
} from "./connectAuth.ts";

describe("connectAuth", () => {
  it("round-trips state, challenge, and loopback port through the authorize URL fragment", () => {
    const url = buildConnectAuthorizeRequestUrl({
      hostedAppUrl: "https://app.kata.sh",
      state: "q7mK9xV2pL4nR8sT6wYzAQ",
      challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      loopbackPort: 34338,
    });
    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://app.kata.sh");
    expect(parsed.pathname).toBe("/connect");
    expect(parsed.search).toBe("");
    expect(readConnectAuthorizeRequest(parsed)).toEqual({
      state: "q7mK9xV2pL4nR8sT6wYzAQ",
      challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      loopbackPort: 34338,
    });
    expect(connectLoopbackRedirectUri(34338)).toBe("http://127.0.0.1:34338/callback");
    expect(parsed.hash).toBe(
      "#s=q7mK9xV2pL4nR8sT6wYzAQ&c=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&p=34338",
    );
    // The link is printed for a human to copy, and wrapping is what clipped it.
    // Short keys save 15 characters against the verbose form; assert both the
    // saving and an absolute budget so neither can regress unnoticed.
    const verbose = url
      .replace("#s=", "#state=")
      .replace("&c=", "&challenge=")
      .replace("&p=", "&port=");
    expect(verbose.length - url.length).toBe(15);
    expect(url.length).toBeLessThanOrEqual(110);
  });

  it("reads verbose authorization parameters from installed CLIs", () => {
    expect(
      readConnectAuthorizeRequest(
        new URL(
          "https://app.kata.sh/connect#state=q7mK9xV2pL4nR8sT6wYzAQ&challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&port=34338",
        ),
      ),
    ).toEqual({
      state: "q7mK9xV2pL4nR8sT6wYzAQ",
      challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      loopbackPort: 34338,
    });
  });

  it("rejects truncated or malformed authorization parameters", () => {
    const state = "q7mK9xV2pL4nR8sT6wYzAQ";
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    for (const [label, hash] of [
      ["clipped state", `#s=${state.slice(0, 18)}&c=${challenge}&p=34338`],
      ["clipped challenge", `#s=${state}&c=${challenge.slice(0, 30)}&p=34338`],
      ["overlong state", `#s=${state}extra&c=${challenge}&p=34338`],
      ["illegal state character", `#s=${state.slice(0, 21)}%21&c=${challenge}&p=34338`],
    ] as const) {
      expect(
        readConnectAuthorizeRequest(new URL(`https://app.kata.sh/connect${hash}`)),
        label,
      ).toBeNull();
    }
  });

  it("rejects authorize requests missing state, challenge, or port", () => {
    expect(readConnectAuthorizeRequest(new URL("https://app.kata.sh/connect"))).toBeNull();
    expect(
      readConnectAuthorizeRequest(new URL("https://app.kata.sh/connect#state=abc&port=34338")),
    ).toBeNull();
    expect(
      readConnectAuthorizeRequest(new URL("https://app.kata.sh/connect#challenge=abc&port=34338")),
    ).toBeNull();
    expect(
      readConnectAuthorizeRequest(new URL("https://app.kata.sh/connect#state=abc&challenge=abc")),
    ).toBeNull();
  });

  it("rejects authorize requests whose loopback port is corrupted", () => {
    for (const port of ["", "abc", "-1", "0", "65536", "34338x", "34 38"]) {
      const url = new URL(
        `https://app.kata.sh/connect#s=q7mK9xV2pL4nR8sT6wYzAQ&c=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&p=${encodeURIComponent(port)}`,
      );
      expect(readConnectAuthorizeRequest(url), port).toBeNull();
    }
  });

  it("builds a PKCE authorize URL against the Clerk endpoint", () => {
    const url = new URL(
      buildConnectClerkAuthorizeUrl({
        authorizationEndpoint: "https://clerk.t3.codes/oauth/authorize",
        clientId: "oauthapp_123",
        redirectUri: connectLoopbackRedirectUri(34338),
        scopes: ["openid", "profile", "email", "offline_access"],
        state: "state-1",
        challenge: "challenge-1",
      }),
    );

    expect(url.origin).toBe("https://clerk.t3.codes");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("oauthapp_123");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:34338/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid profile email offline_access");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});
