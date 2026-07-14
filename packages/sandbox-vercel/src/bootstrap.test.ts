import { describe, expect, it } from "vite-plus/test";

import {
  buildBootstrapScript,
  buildGitHubCliInstallScript,
  buildKillServeCommand,
  buildReplaceServeCommand,
  buildServeCommand,
} from "./bootstrap.ts";

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

describe("serve replace helpers", () => {
  it("kills prior katacode serve and waits for the port to free", () => {
    const kill = buildKillServeCommand(13773);
    expect(kill).toContain("pkill -9 -f '[k]atacode serve --port 13773'");
    expect(kill).toContain("grep -q ':13773 '");
    expect(kill).toContain(
      "! ((ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null || true) | grep -q ':13773 ')",
    );
  });

  it("atomically kills then launches serve with a fresh bootstrap token", () => {
    const cmd = buildReplaceServeCommand({
      port: 13773,
      env: [["KATACODE_DESKTOP_BOOTSTRAP_TOKEN", "fresh"]],
    });
    expect(cmd.startsWith(buildKillServeCommand(13773))).toBe(true);
    expect(cmd).toContain("katacode serve --port 13773");
    expect(cmd).toContain("KATACODE_DESKTOP_BOOTSTRAP_TOKEN='fresh'");
    expect(cmd).toContain("nohup env");
  });

  it("launches serve with inlined env for a fresh bootstrap token", () => {
    const cmd = buildServeCommand({
      port: 13773,
      env: [["KATACODE_DESKTOP_BOOTSTRAP_TOKEN", "fresh"]],
    });
    expect(cmd).toContain("katacode serve --port 13773");
    expect(cmd).toContain("KATACODE_DESKTOP_BOOTSTRAP_TOKEN='fresh'");
    expect(cmd).toContain("nohup env");
  });
});
