import { describe, expect, it } from "vite-plus/test";

import { resolveEnvironmentConfig } from "./environmentResolver.ts";
import type { EnvironmentConfig } from "@kata-sh/code-sandbox-contracts/environmentConfig";

const cfg = (overrides: Partial<EnvironmentConfig>): EnvironmentConfig =>
  ({ ...overrides }) as EnvironmentConfig;

describe("resolveEnvironmentConfig (AC-2.1)", () => {
  it("repo-file install wins over provider default (tracer bullet)", () => {
    const resolved = resolveEnvironmentConfig({
      repoFileConfig: cfg({ install: "pnpm i" }),
      providerDefault: cfg({ install: "default-install" }),
    });
    expect(resolved.install).toBe("pnpm i");
    expect(resolved.provenance.install).toBe("repo-file");
  });

  it("saved-env install wins over provider default", () => {
    const resolved = resolveEnvironmentConfig({
      savedEnvConfig: cfg({ install: "yarn" }),
      providerDefault: cfg({ install: "default-install" }),
    });
    expect(resolved.install).toBe("yarn");
    expect(resolved.provenance.install).toBe("saved-env");
  });

  it("repo-file wins over saved-env which wins over provider default (full chain)", () => {
    const resolved = resolveEnvironmentConfig({
      repoFileConfig: cfg({ install: "pnpm i" }),
      savedEnvConfig: cfg({ install: "yarn" }),
      providerDefault: cfg({ install: "default-install" }),
    });
    expect(resolved.install).toBe("pnpm i");
    expect(resolved.provenance.install).toBe("repo-file");
  });

  it("records per-field provenance: each field reports the source it came from", () => {
    const resolved = resolveEnvironmentConfig({
      repoFileConfig: cfg({ install: "pnpm i", start: "pnpm dev" }),
      savedEnvConfig: cfg({ install: "yarn", terminals: [{ name: "web", command: "serve" }] }),
      providerDefault: cfg({ start: "default-start", snapshot: "v1" }),
    });
    // install from repo-file (wins over saved-env yarn)
    expect(resolved.install).toBe("pnpm i");
    expect(resolved.provenance.install).toBe("repo-file");
    // start from repo-file (wins over provider default)
    expect(resolved.start).toBe("pnpm dev");
    expect(resolved.provenance.start).toBe("repo-file");
    // terminals from saved-env (repo-file omits it)
    expect(resolved.terminals).toEqual([{ name: "web", command: "serve" }]);
    expect(resolved.provenance.terminals).toBe("saved-env");
    // snapshot from provider default (both earlier sources omit it)
    expect(resolved.snapshot).toBe("v1");
    expect(resolved.provenance.snapshot).toBe("provider-default");
  });

  it("terminals from the winning source replaces rather than concatenates", () => {
    const resolved = resolveEnvironmentConfig({
      repoFileConfig: cfg({ terminals: [{ name: "a", command: "a" }] }),
      savedEnvConfig: cfg({ terminals: [{ name: "b", command: "b" }] }),
      providerDefault: cfg({ terminals: [{ name: "c", command: "c" }] }),
    });
    expect(resolved.terminals).toEqual([{ name: "a", command: "a" }]);
    expect(resolved.provenance.terminals).toBe("repo-file");
  });

  it("an empty terminals array is present and wins (a source may explicitly clear terminals)", () => {
    const resolved = resolveEnvironmentConfig({
      repoFileConfig: cfg({ terminals: [] }),
      savedEnvConfig: cfg({ terminals: [{ name: "b", command: "b" }] }),
      providerDefault: cfg({ terminals: [{ name: "c", command: "c" }] }),
    });
    expect(resolved.terminals).toEqual([]);
    expect(resolved.provenance.terminals).toBe("repo-file");
  });

  it("build and snapshot are resolved and round-tripped (parsed but not executed)", () => {
    const resolved = resolveEnvironmentConfig({
      repoFileConfig: cfg({
        build: { dockerfile: "Dockerfile" },
        snapshot: "base",
      }),
      savedEnvConfig: cfg({
        build: { dockerfile: "Other.dockerfile", context: "ctx" },
        snapshot: "saved-snap",
      }),
      providerDefault: cfg({ snapshot: "default-snap" }),
    });
    // repo-file build wins over saved-env build
    expect(resolved.build).toEqual({ dockerfile: "Dockerfile" });
    expect(resolved.provenance.build).toBe("repo-file");
    // repo-file snapshot wins over both
    expect(resolved.snapshot).toBe("base");
    expect(resolved.provenance.snapshot).toBe("repo-file");
  });

  it("all-absent resolves to providerDefault fields; empty {} default yields empty resolved config and empty provenance", () => {
    const resolved = resolveEnvironmentConfig({
      repoFileConfig: cfg({}),
      savedEnvConfig: cfg({}),
      providerDefault: cfg({}),
    });
    expect(resolved.install).toBeUndefined();
    expect(resolved.start).toBeUndefined();
    expect(resolved.terminals).toBeUndefined();
    expect(resolved.build).toBeUndefined();
    expect(resolved.snapshot).toBeUndefined();
    expect(resolved.provenance).toEqual({});
  });

  it("providerDefault alone supplies fields when earlier sources are undefined", () => {
    const resolved = resolveEnvironmentConfig({
      providerDefault: cfg({ install: "default-install", start: "default-start" }),
    });
    expect(resolved.install).toBe("default-install");
    expect(resolved.start).toBe("default-start");
    expect(resolved.provenance).toEqual({
      install: "provider-default",
      start: "provider-default",
    });
  });
});
