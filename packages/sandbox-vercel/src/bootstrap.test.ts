import { describe, expect, it } from "vite-plus/test";

import {
  buildBootstrapScript,
  buildGitHubCliInstallScript,
  buildKillServeCommand,
  buildReplaceServeCommand,
  buildServeCommand,
  KATA_CLI_DEPENDENCY_PINS,
  PI_SDK_PIN,
  PROVIDER_CLI_PACKAGES,
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

  it("pins the pi SDK trio so npm dedupes the kata CLI's ^0.80.0 ranges to the known-good build", () => {
    // The published Kata CLI and sandbox Pi binary must use the same tested
    // ModelRuntime API. Every Pi spec in the install command carries the pin
    // to keep the runtime packages in lockstep.
    expect(PI_SDK_PIN).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PROVIDER_CLI_PACKAGES).toContain(`@earendil-works/pi-coding-agent@${PI_SDK_PIN}`);
    expect(PROVIDER_CLI_PACKAGES).not.toContain("@earendil-works/pi-coding-agent");
    expect(KATA_CLI_DEPENDENCY_PINS).toEqual([
      `@earendil-works/pi-ai@${PI_SDK_PIN}`,
      `@earendil-works/pi-agent-core@${PI_SDK_PIN}`,
    ]);
    const script = buildBootstrapScript();
    expect(script).toContain(`npm install -g `);
    expect(script).toContain(`@earendil-works/pi-coding-agent@${PI_SDK_PIN}`);
    expect(script).toContain(`@earendil-works/pi-ai@${PI_SDK_PIN}`);
    expect(script).toContain(`@earendil-works/pi-agent-core@${PI_SDK_PIN}`);
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
