import { describe, expect, it } from "vite-plus/test";

import { buildBootstrapScript, buildGitHubCliInstallScript } from "./bootstrap.ts";

describe("GitHub CLI bootstrap", () => {
  it("installs gh from the official RPM repository and verifies the binary", () => {
    expect(buildGitHubCliInstallScript()).toBe(
      [
        "sudo dnf install -y 'dnf-command(config-manager)'",
        "sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo",
        "sudo dnf install -y gh",
        "gh --version",
      ].join(" && "),
    );
  });

  it("includes the verified GitHub CLI installation in the full bootstrap", () => {
    expect(buildBootstrapScript()).toContain(buildGitHubCliInstallScript());
  });
});
