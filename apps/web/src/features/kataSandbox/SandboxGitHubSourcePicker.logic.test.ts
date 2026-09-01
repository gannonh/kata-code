import { describe, expect, it } from "vite-plus/test";

import {
  appendUniqueBy,
  createRequestGeneration,
  filterByQuery,
} from "./SandboxGitHubSourcePicker.logic";

describe("SandboxGitHubSourcePicker logic", () => {
  it("accepts only the latest request generation", () => {
    const requests = createRequestGeneration();
    const first = requests.begin();
    const second = requests.begin();

    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.isCurrent(second)).toBe(true);
  });

  it("drops a stale branch response after the repository selection changes", () => {
    const branchRequests = createRequestGeneration();
    const previousRepositoryRequest = branchRequests.begin();

    branchRequests.invalidate();

    expect(branchRequests.isCurrent(previousRepositoryRequest)).toBe(false);
  });

  it("drops a pending repository response after the picker unmounts", () => {
    const repositoryRequests = createRequestGeneration();
    const pendingRequest = repositoryRequests.begin();

    repositoryRequests.invalidate();

    expect(repositoryRequests.isCurrent(pendingRequest)).toBe(false);
  });

  it("deduplicates paginated results while preserving their first-seen order", () => {
    expect(
      appendUniqueBy(
        [
          { nameWithOwner: "kata/one", defaultBranch: "main" },
          { nameWithOwner: "kata/two", defaultBranch: "main" },
        ],
        [
          { nameWithOwner: "kata/two", defaultBranch: "develop" },
          { nameWithOwner: "kata/three", defaultBranch: "main" },
        ],
        (repository) => repository.nameWithOwner,
      ),
    ).toEqual([
      { nameWithOwner: "kata/one", defaultBranch: "main" },
      { nameWithOwner: "kata/two", defaultBranch: "main" },
      { nameWithOwner: "kata/three", defaultBranch: "main" },
    ]);
  });

  it("filters loaded values locally without changing their casing", () => {
    expect(filterByQuery(["Main", "release/One", "release/Two"], "RELEASE")).toEqual([
      "release/One",
      "release/Two",
    ]);
  });
});
