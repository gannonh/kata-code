import { describe, expect, it } from "@effect/vitest";

import { redactDiagnostic, redactSecrets } from "./redactSecrets.ts";

describe("redactSecrets", () => {
  it("removes credentials from nested provider diagnostics", () => {
    expect(
      redactSecrets({
        status: 500,
        auth: { token: "super-secret" },
        nested: [{ password: "secret", message: "daemon unavailable" }],
      }),
    ).toEqual({
      status: 500,
      auth: "[redacted]",
      nested: [{ password: "[redacted]", message: "daemon unavailable" }],
    });
  });

  it("serializes redacted diagnostics for an API-safe message", () => {
    expect(redactDiagnostic({ credential: "secret", detail: "unavailable" })).toBe(
      '{"credential":"[redacted]","detail":"unavailable"}',
    );
  });

  it("returns a fallback for undefined diagnostics", () => {
    expect(redactDiagnostic(undefined)).toBe("Unknown diagnostic");
  });
});
