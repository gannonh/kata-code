// @effect-diagnostics nodeBuiltinImport:off - host-side temp-dir setup uses node:fs/node:path for the opencode seed test.
import { describe, expect } from "vite-plus/test";
import { it as vitIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { buildCredentialSeedArchives } from "./credentialSeed.ts";

/**
 * opencode auth.json lives at XDG data home (`~/.local/share/opencode/auth.json`),
 * not the spec's `~/.config/opencode/auth.json`. This test confirms the seed
 * targets the data-home path so a started Vercel sandbox reports opencode
 * authenticated without env-var configuration (AC-3b.10).
 */
describe("credentialSeed opencode spec", () => {
  vitIt.effect(
    "opencode auth.json lands in the credentials archive at .local/share/opencode/auth.json",
    () =>
      Effect.gen(function* () {
        const tmpHome = yield* Effect.promise(() =>
          fs.promises.mkdtemp(path.join(os.tmpdir(), "kata-seed-")),
        );
        const opencodeDir = path.join(tmpHome, ".local/share/opencode");
        yield* Effect.promise(() => fs.promises.mkdir(opencodeDir, { recursive: true }));
        yield* Effect.promise(() =>
          fs.promises.writeFile(path.join(opencodeDir, "auth.json"), '{"token":"opencode-tok"}', {
            mode: 0o600,
          }),
        );
        // Exclude runtime state so only auth.json ships in the credentials archive.
        yield* Effect.promise(() =>
          fs.promises.mkdir(path.join(opencodeDir, "log"), { recursive: true }),
        );
        yield* Effect.promise(() =>
          fs.promises.writeFile(path.join(opencodeDir, "log", "run.log"), "noise"),
        );

        const archives = yield* buildCredentialSeedArchives({ hostHome: tmpHome });
        yield* Effect.promise(() => fs.promises.rm(tmpHome, { recursive: true, force: true }));

        expect(archives.credentials).not.toBeNull();
        // The tar entries are USTAR; a string includes check is sufficient to
        // confirm the data-home relative path is present.
        const tarText = Buffer.from(archives.credentials as Uint8Array).toString("latin1");
        expect(tarText).toContain(".local/share/opencode/auth.json");
        expect(tarText).toContain("opencode-tok");
        // Runtime state is excluded.
        expect(tarText).not.toContain("run.log");
      }),
  );
});

describe("buildCredentialSeedArchives stored credentials", () => {
  vitIt.effect("stored credential lands in the archive; host file wins on collision", () =>
    Effect.gen(function* () {
      const tmpHome = yield* Effect.promise(() =>
        fs.promises.mkdtemp(path.join(os.tmpdir(), "kata-seed-")),
      );
      const codexDir = path.join(tmpHome, ".codex");
      yield* Effect.promise(() => fs.promises.mkdir(codexDir, { recursive: true }));
      // Host-collected codex auth (wins over the stored credential).
      yield* Effect.promise(() =>
        fs.promises.writeFile(path.join(codexDir, "auth.json"), '{"host":true}', { mode: 0o600 }),
      );
      const archives = yield* buildCredentialSeedArchives({
        hostHome: tmpHome,
        storedCredentials: [
          {
            relativePath: ".codex/auth.json",
            content: Buffer.from('{"stored":true}'),
            mode: 0o600,
          },
          {
            relativePath: "custom-provider/auth.json",
            content: Buffer.from('{"custom":"tok"}'),
            mode: 0o600,
          },
        ],
      });
      yield* Effect.promise(() => fs.promises.rm(tmpHome, { recursive: true, force: true }));
      const tarText = Buffer.from(archives.credentials as Uint8Array).toString("latin1");
      // Host file wins on collision — stored codex is NOT present.
      expect(tarText).toContain('{"host":true}');
      expect(tarText).not.toContain('{"stored":true}');
      // Non-colliding stored credential IS present.
      expect(tarText).toContain('{"custom":"tok"}');
    }),
  );
});

describe("credentialSeed host install trees", () => {
  vitIt.effect("excludes ~/.codex/packages standalone binaries from the static archive", () =>
    Effect.gen(function* () {
      // Host Codex installs multi-hundred-MB darwin binaries under
      // packages/standalone. Packing those into writeFiles trips Vercel
      // Sandbox's body limit ("Request Entity Too Large").
      const tmpHome = yield* Effect.promise(() =>
        fs.promises.mkdtemp(path.join(os.tmpdir(), "kata-seed-")),
      );
      const packagesBin = path.join(tmpHome, ".codex", "packages", "standalone", "current", "bin");
      yield* Effect.promise(() => fs.promises.mkdir(packagesBin, { recursive: true }));
      yield* Effect.promise(() =>
        fs.promises.writeFile(path.join(packagesBin, "codex"), "HOST_CODEX_BINARY"),
      );
      yield* Effect.promise(() =>
        fs.promises.writeFile(path.join(tmpHome, ".codex", "config.toml"), 'model = "gpt-5"\n'),
      );

      const archives = yield* buildCredentialSeedArchives({ hostHome: tmpHome });
      yield* Effect.promise(() => fs.promises.rm(tmpHome, { recursive: true, force: true }));

      expect(archives.static).not.toBeNull();
      const tarText = Buffer.from(archives.static as Uint8Array).toString("latin1");
      expect(tarText).toContain(".codex/config.toml");
      expect(tarText).not.toContain("HOST_CODEX_BINARY");
      expect(tarText).not.toContain("packages/standalone");
    }),
  );
});

describe("credentialSeed pi extension packages", () => {
  vitIt.effect("keeps npm package specs so sandbox extensions can be installed", () =>
    Effect.gen(function* () {
      // Pi extensions register providers at runtime (pi-anthropic-oauth supplies
      // the Anthropic OAuth provider). Dropping `packages` left seeded OAuth
      // credentials unusable and turns settled with no assistant output.
      const tmpHome = yield* Effect.promise(() =>
        fs.promises.mkdtemp(path.join(os.tmpdir(), "kata-seed-")),
      );
      const piDir = path.join(tmpHome, ".pi", "agent");
      yield* Effect.promise(() => fs.promises.mkdir(piDir, { recursive: true }));
      yield* Effect.promise(() =>
        fs.promises.writeFile(
          path.join(piDir, "settings.json"),
          '{"defaultProvider":"anthropic","packages":["npm:pi-anthropic-oauth","file:/Users/host/local-ext"]}',
        ),
      );
      yield* Effect.promise(() =>
        fs.promises.writeFile(path.join(piDir, "auth.json"), '{"anthropic":{"type":"oauth"}}', {
          mode: 0o600,
        }),
      );
      // Host install tree stays excluded: darwin binaries cannot run in a Linux VM.
      const hostModules = path.join(piDir, "npm", "node_modules", "pi-anthropic-oauth");
      yield* Effect.promise(() => fs.promises.mkdir(hostModules, { recursive: true }));
      yield* Effect.promise(() =>
        fs.promises.writeFile(path.join(hostModules, "index.js"), "HOST_EXTENSION_BUILD"),
      );

      const archives = yield* buildCredentialSeedArchives({ hostHome: tmpHome });
      yield* Effect.promise(() => fs.promises.rm(tmpHome, { recursive: true, force: true }));

      const staticText = Buffer.from(archives.static as Uint8Array).toString("latin1");
      expect(staticText).toContain("npm:pi-anthropic-oauth");
      // Host-only specs cannot resolve in the sandbox.
      expect(staticText).not.toContain("file:/Users/host/local-ext");
      expect(staticText).not.toContain("HOST_EXTENSION_BUILD");
    }),
  );
});
