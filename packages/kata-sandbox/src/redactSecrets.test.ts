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

it("redacts complete quoted secrets, bearer credentials, and URL userinfo", () => {
  const value = redactDiagnostic(
    new Error(
      'password="sentinel phrase" token=sentinel-token Authorization: Bearer sentinel-bearer https://sentinel-user:sentinel-pass@example.com https://sentinel-token@example.com/repo',
    ),
  );
  for (const secret of ["sentinel", "phrase"]) expect(value).not.toContain(secret);
  expect(value).toContain("[redacted]");
});
