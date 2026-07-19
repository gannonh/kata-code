import { describe, expect, it } from "vite-plus/test";

import {
  buildGitHubHttpsUrl,
  deriveGitHubRepositoryKey,
  resolveSandboxGitHubSource,
  sourceFingerprint,
} from "./sandboxGitHubSource.ts";

describe("sandboxGitHubSource", () => {
  it("derives the canonical repository key from owner/name", () => {
    expect(deriveGitHubRepositoryKey("Octocat/Hello-World")).toBe("github.com/octocat/hello-world");
  });

  it("builds the HTTPS clone URL from owner/name", () => {
    expect(buildGitHubHttpsUrl("octocat/Hello-World")).toBe(
      "https://github.com/octocat/Hello-World.git",
    );
  });

  it("resolves a configured sandbox GitHub source for Docker and Vercel configs", () => {
    const resolved = resolveSandboxGitHubSource({
      source: { repository: "octocat/Hello-World", branch: "main" },
    });
    expect(resolved).toEqual({
      repository: "octocat/Hello-World",
      branch: "main",
      repositoryKey: "github.com/octocat/hello-world",
      httpsUrl: "https://github.com/octocat/Hello-World.git",
    });
  });

  it("returns null when no source is configured", () => {
    expect(resolveSandboxGitHubSource({})).toBeNull();
    expect(resolveSandboxGitHubSource(null)).toBeNull();
    expect(
      resolveSandboxGitHubSource({ source: { repository: "octocat/Hello-World" } }),
    ).toBeNull();
  });

  it("computes a stable fingerprint that changes with repository or branch", () => {
    const base = sourceFingerprint({
      repositoryKey: "github.com/octocat/hello-world",
      branch: "main",
    });
    expect(base).toBe(
      sourceFingerprint({ repositoryKey: "github.com/octocat/hello-world", branch: "main" }),
    );
    expect(base).not.toBe(
      sourceFingerprint({ repositoryKey: "github.com/octocat/hello-world", branch: "dev" }),
    );
    expect(base).not.toBe(
      sourceFingerprint({ repositoryKey: "github.com/octocat/other", branch: "main" }),
    );
  });
});
