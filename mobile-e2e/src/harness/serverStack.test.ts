import { describe, expect, it } from "vitest";

import { parseServeOutput } from "./serverStack.ts";

describe("parseServeOutput", () => {
  const sample = [
    "Kata Code server is ready.",
    "Connection string: http://127.0.0.1:3773",
    "Token: ABC123XYZ",
    "Pairing URL: http://127.0.0.1:3773/pair#token=ABC123XYZ",
    "",
  ].join("\n");

  it("extracts the connection string, derived host, and one-time token", () => {
    const parsed = parseServeOutput(sample);
    expect(parsed).toEqual({
      connectionString: "http://127.0.0.1:3773",
      host: "127.0.0.1:3773",
      token: "ABC123XYZ",
    });
  });

  it("returns undefined until both the connection string and token are present", () => {
    // Token line has not been printed yet — the stdout scanner must keep waiting,
    // not pair with a missing/empty token.
    const partial = "Kata Code server is ready.\nConnection string: http://127.0.0.1:3773\n";
    expect(parseServeOutput(partial)).toBeUndefined();
  });

  it("strips only the scheme, preserving host and port for the pairing form", () => {
    const parsed = parseServeOutput("Connection string: http://localhost:50321\nToken: t-9\n");
    expect(parsed?.host).toBe("localhost:50321");
  });

  it("resolves across chunk boundaries: connection string then token on separate chunks", () => {
    // waitForServePairing accumulates stdout across many `data` events before the
    // token line arrives. The scanner must keep parsing the running buffer, not
    // only the latest chunk, so a split write still resolves.
    const first = "Connection string: http://127.0.0.1:3773\n";
    const second = "Token: ABC123XYZ\n";
    expect(parseServeOutput(first)).toBeUndefined();
    expect(parseServeOutput(first + second)).toBeDefined();
  });
});
