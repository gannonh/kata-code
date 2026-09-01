import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  SandboxGitHubBranchPage,
  SandboxGitHubRepositoryPage,
  SandboxGitHubRepositorySummary,
} from "./http.ts";

describe("GitHub sandbox HTTP contracts", () => {
  it("decodes safe repository metadata for every GitHub visibility", () => {
    const decode = Schema.decodeUnknownSync(SandboxGitHubRepositoryPage);

    expect(
      decode({
        repositories: [
          {
            nameWithOwner: "octocat/private-repo",
            visibility: "private",
            defaultBranch: "main",
          },
          {
            nameWithOwner: "octocat/internal-repo",
            visibility: "internal",
            defaultBranch: "trunk",
          },
          {
            nameWithOwner: "octocat/public-repo",
            visibility: "public",
            defaultBranch: "main",
          },
        ],
        page: 1,
        hasMore: true,
      }),
    ).toEqual({
      repositories: [
        {
          nameWithOwner: "octocat/private-repo",
          visibility: "private",
          defaultBranch: "main",
        },
        {
          nameWithOwner: "octocat/internal-repo",
          visibility: "internal",
          defaultBranch: "trunk",
        },
        {
          nameWithOwner: "octocat/public-repo",
          visibility: "public",
          defaultBranch: "main",
        },
      ],
      page: 1,
      hasMore: true,
    });
  });

  it("decodes paginated branch metadata and rejects malformed pages", () => {
    const decode = Schema.decodeUnknownSync(SandboxGitHubBranchPage);

    expect(decode({ branches: ["main", "release"], page: 2, hasMore: false })).toEqual({
      branches: ["main", "release"],
      page: 2,
      hasMore: false,
    });
    expect(() =>
      Schema.decodeUnknownSync(SandboxGitHubRepositorySummary)({
        nameWithOwner: "octocat/repo",
        visibility: "secret",
        defaultBranch: "main",
      }),
    ).toThrow();
  });
});
