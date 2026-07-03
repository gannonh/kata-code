import { describe, expect, it } from "vite-plus/test";

import { redactSecrets } from "./redactSecrets.ts";

describe("redactSecrets (AC-2.4)", () => {
  it("replaces a known secret value with a placeholder so it never appears in clear text", () => {
    const secret = "super-secret-api-key-12345";
    const text = `Installing with token=${secret} ... done`;
    const redacted = redactSecrets(text, [secret]);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("***");
    expect(redacted).toBe("Installing with token=*** ... done");
  });

  it("redacts multiple distinct secrets in one pass", () => {
    const text = "db=postgres://u:p@host and key=ABCDEF";
    const redacted = redactSecrets(text, ["postgres://u:p@host", "ABCDEF"]);
    expect(redacted).toBe("db=*** and key=***");
  });

  it("redacts a longer secret before a shorter secret that is a substring of it", () => {
    const longer = "AKIA-very-long-secret-value";
    const shorter = "AKIA";
    const text = `creds=${longer}`;
    const redacted = redactSecrets(text, [shorter, longer]);
    // If the shorter "AKIA" were replaced first, the longer value would be
    // corrupted into "***-very-long-secret-value" and the tail would leak.
    // Longest-first ensures the whole longer secret becomes one placeholder.
    expect(redacted).not.toContain(longer);
    expect(redacted).not.toContain("very-long-secret-value");
    expect(redacted).toBe("creds=***");
  });

  it("is a no-op when the secret list is empty", () => {
    const text = "nothing to redact here";
    expect(redactSecrets(text, [])).toBe(text);
  });

  it("skips empty-string secret values (redacting '' would insert placeholders between every char)", () => {
    const text = "install output";
    expect(redactSecrets(text, [""])).toBe(text);
  });
});
