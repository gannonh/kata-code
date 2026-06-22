import { afterEach, describe, expect, it } from "vitest";

import {
  formatMissingPrerequisiteError,
  readClerkPrerequisites,
  readGoogleTestUserPrerequisites,
} from "./env.ts";

describe("readClerkPrerequisites", () => {
  const envKeys = [
    "CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "KATACODE_CLERK_PUBLISHABLE_KEY",
    "VITE_CLERK_PUBLISHABLE_KEY",
  ] as const;
  const previous: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of envKeys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  });

  it("reports missing Clerk keys with the expected variable names", () => {
    for (const key of envKeys) {
      previous[key] = process.env[key];
      delete process.env[key];
    }

    const result = readClerkPrerequisites();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(
        expect.arrayContaining(["CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]),
      );
    }
  });

  it("accepts canonical or Vite-prefixed publishable keys", () => {
    for (const key of envKeys) {
      previous[key] = process.env[key];
      delete process.env[key];
    }
    process.env.VITE_CLERK_PUBLISHABLE_KEY = "pk_test_example";
    process.env.CLERK_SECRET_KEY = "sk_test_example";

    expect(readClerkPrerequisites()).toEqual({ ok: true });
  });
});

describe("readGoogleTestUserPrerequisites", () => {
  const key = "KATACODE_E2E_GOOGLE_EMAIL";
  let previous: string | undefined;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  });

  it("requires the Google test-user email for Clerk ticket sign-in", () => {
    previous = process.env[key];
    delete process.env[key];

    const result = readGoogleTestUserPrerequisites();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(["KATACODE_E2E_GOOGLE_EMAIL"]);
    }
  });
});

describe("formatMissingPrerequisiteError", () => {
  it("includes the phase and required variables", () => {
    const message = formatMissingPrerequisiteError("auth setup", [
      "CLERK_SECRET_KEY",
      "KATACODE_E2E_GOOGLE_EMAIL",
    ]);

    expect(message).toContain("auth setup");
    expect(message).toContain("CLERK_SECRET_KEY");
    expect(message).toContain("KATACODE_E2E_GOOGLE_EMAIL");
  });
});
