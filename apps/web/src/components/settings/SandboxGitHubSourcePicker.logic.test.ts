import { describe, expect, it } from "vite-plus/test";

import { createRequestGeneration } from "./SandboxGitHubSourcePicker.logic";

describe("createRequestGeneration", () => {
  it("accepts only the latest request generation", () => {
    const requests = createRequestGeneration();
    const first = requests.begin();
    const second = requests.begin();

    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.isCurrent(second)).toBe(true);
  });

  it("invalidates an in-flight request when its owner is disposed", () => {
    const requests = createRequestGeneration();
    const pending = requests.begin();

    requests.invalidate();

    expect(requests.isCurrent(pending)).toBe(false);
  });
});
