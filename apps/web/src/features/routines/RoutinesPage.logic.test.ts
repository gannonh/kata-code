import { describe, expect, it } from "vite-plus/test";
import type { ServerProvider, VcsRef } from "@kata-sh/code-contracts";

import {
  canSaveRoutineDraft,
  enabledProviders,
  firstEnabledProviderModel,
  preferredWorktreeBaseBranch,
  routinesLibraryEmptyKind,
  worktreeBaseExists,
} from "./RoutinesPage.logic";

function ref(name: string, flags: Partial<VcsRef> = {}): VcsRef {
  return {
    name,
    current: false,
    isDefault: false,
    isRemote: false,
    worktreePath: null,
    ...flags,
  };
}

function provider(input: {
  readonly instanceId: string;
  readonly enabled?: boolean;
  readonly status?: ServerProvider["status"];
  readonly availability?: ServerProvider["availability"];
  readonly models?: ServerProvider["models"];
}): ServerProvider {
  return {
    instanceId: input.instanceId as ServerProvider["instanceId"],
    driver: "codex" as ServerProvider["driver"],
    enabled: input.enabled ?? true,
    installed: true,
    version: "1",
    status: input.status ?? "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: input.models ?? [
      { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, capabilities: null },
    ],
    slashCommands: [],
    skills: [],
    ...(input.availability ? { availability: input.availability } : {}),
  };
}

describe("preferredWorktreeBaseBranch", () => {
  it("prefers the repository default over the current checkout", () => {
    expect(
      preferredWorktreeBaseBranch([
        ref("feature/local", { current: true }),
        ref("origin/master", { isRemote: true, remoteName: "origin", isDefault: true }),
      ]),
    ).toBe("master");
  });

  it("falls back to the current local branch when no default is advertised", () => {
    expect(
      preferredWorktreeBaseBranch([ref("trunk", { current: true }), ref("origin/main", { isRemote: true, remoteName: "origin" })]),
    ).toBe("trunk");
  });
});

describe("worktreeBaseExists", () => {
  it("matches a local or remote short name", () => {
    const refs = [ref("trunk"), ref("origin/trunk", { isRemote: true, remoteName: "origin" })];
    expect(worktreeBaseExists(refs, "trunk")).toBe(true);
    expect(worktreeBaseExists(refs, "main")).toBe(false);
  });
});

describe("enabledProviders", () => {
  it("drops disabled and unavailable instances", () => {
    expect(
      enabledProviders([
        provider({ instanceId: "codex", enabled: false }),
        provider({ instanceId: "claude", status: "disabled" }),
        provider({ instanceId: "grok", availability: "unavailable" }),
        provider({ instanceId: "ok" }),
      ]).map((entry) => entry.instanceId),
    ).toEqual(["ok"]);
  });
});

describe("firstEnabledProviderModel", () => {
  it("returns null when no enabled provider has a model", () => {
    expect(firstEnabledProviderModel([provider({ instanceId: "codex", enabled: false })])).toBeNull();
  });
});

describe("canSaveRoutineDraft", () => {
  it("requires an enabled provider", () => {
    expect(
      canSaveRoutineDraft({
        name: "Daily",
        instruction: "Summarize",
        hasProject: true,
        offline: false,
        busy: false,
        provider: provider({ instanceId: "codex", enabled: false }),
      }),
    ).toBe(false);
  });
});

describe("routinesLibraryEmptyKind", () => {
  it("does not treat an unavailable environment as an empty library", () => {
    expect(
      routinesLibraryEmptyKind({ routineCount: 0, unavailableCount: 1, pendingCount: 0 }),
    ).toBe("unavailable");
    expect(routinesLibraryEmptyKind({ routineCount: 0, unavailableCount: 0, pendingCount: 0 })).toBe(
      "empty",
    );
  });
});
