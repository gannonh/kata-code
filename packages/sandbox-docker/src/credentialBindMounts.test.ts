// @effect-diagnostics globalDateInEffect:off - pure function tests; no Effect Clock.
import { describe, expect, it } from "vite-plus/test";

import {
  buildCredentialBindMounts,
  type CredentialBindMountInput,
} from "./credentialBindMounts.ts";

/** Build an input with a synthetic host home and an exists-predicate backed by a set. */
function makeInput(opts: {
  readonly hostHome?: string;
  readonly containerHome?: string;
  readonly env?: ReadonlyArray<readonly [string, string]>;
  readonly existing?: ReadonlyArray<string>;
}): CredentialBindMountInput {
  const hostHome = opts.hostHome ?? "/host-home";
  const containerHome = opts.containerHome ?? "/home/katacode";
  const existing = new Set(opts.existing ?? []);
  return {
    hostHome,
    containerHome,
    env: opts.env ?? [],
    hostPathExists: (path) => existing.has(path),
  };
}

describe("buildCredentialBindMounts (Phase 3a credential bind-mounts)", () => {
  it("mounts ~/.claude rw, ~/.claude.json rw, ~/.codex ro, ~/.config/opencode ro when all exist", () => {
    const mounts = buildCredentialBindMounts(
      makeInput({
        existing: [
          "/host-home/.claude",
          "/host-home/.claude.json",
          "/host-home/.codex",
          "/host-home/.config/opencode",
        ],
      }),
    );

    const byTarget = new Map(mounts.map((m) => [m.target, m]));
    expect(mounts).toHaveLength(4);

    const claude = byTarget.get("/home/katacode/.claude");
    expect(claude).toEqual({
      source: "/host-home/.claude",
      target: "/home/katacode/.claude",
      readOnly: false,
    });

    const claudeJson = byTarget.get("/home/katacode/.claude.json");
    expect(claudeJson).toEqual({
      source: "/host-home/.claude.json",
      target: "/home/katacode/.claude.json",
      readOnly: false,
    });

    const codex = byTarget.get("/home/katacode/.codex");
    expect(codex).toEqual({
      source: "/host-home/.codex",
      target: "/home/katacode/.codex",
      readOnly: true,
    });

    const opencode = byTarget.get("/home/katacode/.config/opencode");
    expect(opencode).toEqual({
      source: "/host-home/.config/opencode",
      target: "/home/katacode/.config/opencode",
      readOnly: true,
    });
  });

  it("skips a credential dir that is absent on the host (missing mount is not fatal)", () => {
    const mounts = buildCredentialBindMounts(
      makeInput({
        existing: ["/host-home/.claude", "/host-home/.codex"],
      }),
    );
    const targets = mounts.map((m) => m.target).sort();
    expect(targets).toEqual(["/home/katacode/.claude", "/home/katacode/.codex"]);
  });

  it("returns no mounts when no host credential paths exist", () => {
    const mounts = buildCredentialBindMounts(makeInput({ existing: [] }));
    expect(mounts).toEqual([]);
  });

  it("targets CODEX_HOME when the container env sets it (shadow-home precedence)", () => {
    const mounts = buildCredentialBindMounts(
      makeInput({
        existing: ["/host-home/.codex"],
        env: [["CODEX_HOME", "/home/katacode/.codex-shadow"]],
      }),
    );
    const codex = mounts.find((m) => m.source === "/host-home/.codex");
    expect(codex).toBeDefined();
    expect(codex?.target).toBe("/home/katacode/.codex-shadow");
    expect(codex?.readOnly).toBe(true);
  });

  it("ignores an empty CODEX_HOME env value and falls back to the default target", () => {
    const mounts = buildCredentialBindMounts(
      makeInput({
        existing: ["/host-home/.codex"],
        env: [["CODEX_HOME", ""]],
      }),
    );
    const codex = mounts.find((m) => m.source === "/host-home/.codex");
    expect(codex?.target).toBe("/home/katacode/.codex");
  });

  it("mounts an empty-but-present host dir (existence, not contents, gates the mount)", () => {
    const mounts = buildCredentialBindMounts(makeInput({ existing: ["/host-home/.codex"] }));
    expect(mounts).toHaveLength(1);
    expect(mounts[0]?.source).toBe("/host-home/.codex");
  });
});
