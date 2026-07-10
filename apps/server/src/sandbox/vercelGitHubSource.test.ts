import { describe, expect, it } from "vite-plus/test";

import {
  buildGitHubHttpsUrl,
  deriveGitHubRepositoryKey,
  resolveVercelSource,
  sourceFingerprint,
} from "./vercelGitHubSource.ts";

describe("vercelGitHubSource", () => {
  it("derives the canonical repository key from owner/name", () => {
    expect(deriveGitHubRepositoryKey("Octocat/Hello-World")).toBe("github.com/octocat/hello-world");
  });

  it("builds the HTTPS clone URL from owner/name", () => {
    expect(buildGitHubHttpsUrl("octocat/Hello-World")).toBe(
      "https://github.com/octocat/Hello-World.git",
    );
  });

  it("resolves a configured Vercel source", () => {
    const resolved = resolveVercelSource({
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
    expect(resolveVercelSource({})).toBeNull();
    expect(resolveVercelSource(null)).toBeNull();
    expect(resolveVercelSource({ source: { repository: "octocat/Hello-World" } })).toBeNull();
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
