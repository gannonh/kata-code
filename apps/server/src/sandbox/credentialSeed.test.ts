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
