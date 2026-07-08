import { describe, expect, it } from "vite-plus/test";

import { extractProviderLoginUrl, PROVIDER_LOGIN_SPECS } from "./providerLogin.ts";

const claudeSpec = PROVIDER_LOGIN_SPECS.find((spec) => spec.providerId === "claude");

if (!claudeSpec) {
  throw new Error("Claude provider login spec missing.");
}

describe("extractProviderLoginUrl", () => {
  it("prefers Claude OSC-8 hyperlink URLs over truncated visible terminal text", () => {
    const fullUrl =
      "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=abc&code_challenge_method=S256&state=xyz";
    const output = [
      "Browser didn't open? Use the url below to sign in",
      `\x1b]8;id=abc;${fullUrl}\x07https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88\x1b]8;;\x07`,
    ].join("\n");

    expect(extractProviderLoginUrl(output, claudeSpec.urlPattern)).toBe(fullUrl);
  });

  it("falls back to plain text provider URLs", () => {
    const url =
      "https://claude.com/cai/oauth/authorize?code=true&client_id=client&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=abc&code_challenge_method=S256&state=xyz";

    expect(extractProviderLoginUrl(`Open ${url}`, claudeSpec.urlPattern)).toBe(url);
  });
});
