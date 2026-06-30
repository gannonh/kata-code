// @effect-diagnostics nodeBuiltinImport:off - temp-dir fixtures for the host-side tar builder tests.
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { buildRepoSeedArchive, SeedArchiveError } from "./repoSeedArchive.ts";

/** Parse a ustar tar archive into a map of `name -> content` (files only). */
function parseTarEntries(archive: Uint8Array): Map<string, string> {
  const buf = Buffer.from(archive);
  const entries = new Map<string, string>();
  let i = 0;
  while (i + 512 <= buf.length) {
    const header = buf.subarray(i, i + 512);
    // Two consecutive zero blocks terminate the archive.
    if (header.every((b) => b === 0)) break;
    // name is the first 100 bytes, null-terminated.
    const name = header.subarray(0, 100).toString("utf8").replace(/\0+$/, "");
    // size is octal at offset 124, 11 digits + null.
    const sizeOct = header.subarray(124, 135).toString("utf8").replace(/\0+$/, "").trim();
    const size = parseInt(sizeOct || "0", 8);
    const typeflag = String.fromCharCode(header[156] ?? 0x30);
    i += 512;
    if (typeflag === "0" || typeflag === "\0") {
      // Regular file.
      const content = buf.subarray(i, i + size).toString("utf8");
      entries.set(name, content);
    }
    // Skip the content, padded to a 512 boundary.
    const padded = Math.ceil(size / 512) * 512;
    i += padded;
  }
  return entries;
}

/** Create a temp dir, run the test body, and always remove it afterward. */
async function withTempDir(name: string, body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `kata-seed-${name}-`));
  try {
    await body(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

describe("buildRepoSeedArchive (tar writer round-trip)", () => {
  it("packs a single file into a readable tar entry (tracer bullet)", async () => {
    await withTempDir("single", async (dir) => {
      await fs.writeFile(path.join(dir, "hello.txt"), "hello-from-host");
      const archive = await buildRepoSeedArchive(dir, {});
      const entries = parseTarEntries(archive);
      expect(entries.get("hello.txt")).toBe("hello-from-host");
    });
  });

  it("packs nested files preserving relative paths", async () => {
    await withTempDir("nested", async (dir) => {
      await fs.mkdir(path.join(dir, "src"));
      await fs.writeFile(path.join(dir, "src", "a.ts"), "export const a = 1;");
      await fs.writeFile(path.join(dir, "package.json"), '{"name":"x"}');
      const archive = await buildRepoSeedArchive(dir, {});
      const entries = parseTarEntries(archive);
      expect(entries.get("src/a.ts")).toBe("export const a = 1;");
      expect(entries.get("package.json")).toBe('{"name":"x"}');
    });
  });
});

describe("buildRepoSeedArchive (bounded copy + gitignore subset)", () => {
  it("skips .git and node_modules components", async () => {
    await withTempDir("skip", async (dir) => {
      await fs.writeFile(path.join(dir, "keep.txt"), "keep");
      await fs.mkdir(path.join(dir, ".git"));
      await fs.writeFile(path.join(dir, ".git", "config"), "git-config");
      await fs.mkdir(path.join(dir, "node_modules"));
      await fs.writeFile(path.join(dir, "node_modules", "dep.js"), "module");
      const archive = await buildRepoSeedArchive(dir, {});
      const entries = parseTarEntries(archive);
      expect(entries.has("keep.txt")).toBe(true);
      expect(entries.has(".git/config")).toBe(false);
      expect(entries.has("node_modules/dep.js")).toBe(false);
    });
  });

  it("honors a .gitignore pattern (skips ignored files, keeps the rest)", async () => {
    await withTempDir("ignore", async (dir) => {
      await fs.writeFile(path.join(dir, ".gitignore"), "*.log\n.env\n");
      await fs.writeFile(path.join(dir, "keep.txt"), "keep");
      await fs.writeFile(path.join(dir, "debug.log"), "ignored-log");
      await fs.writeFile(path.join(dir, ".env"), "SECRET=ignored");
      const archive = await buildRepoSeedArchive(dir, {});
      const entries = parseTarEntries(archive);
      expect(entries.has("keep.txt")).toBe(true);
      expect(entries.has("debug.log")).toBe(false);
      expect(entries.has(".env")).toBe(false);
      // The .gitignore file itself is included (it is not self-ignored).
      expect(entries.has(".gitignore")).toBe(true);
    });
  });

  it("respects a negation pattern that un-ignores a file", async () => {
    await withTempDir("negate", async (dir) => {
      await fs.writeFile(path.join(dir, ".gitignore"), "*.log\n!important.log\n");
      await fs.writeFile(path.join(dir, "debug.log"), "ignored");
      await fs.writeFile(path.join(dir, "important.log"), "kept");
      const archive = await buildRepoSeedArchive(dir, {});
      const entries = parseTarEntries(archive);
      expect(entries.has("debug.log")).toBe(false);
      expect(entries.has("important.log")).toBe(true);
      expect(entries.get("important.log")).toBe("kept");
    });
  });

  it("fails loud (SeedArchiveError) when the file cap is exceeded", async () => {
    await withTempDir("filecap", async (dir) => {
      // Write 3 files but cap at 2.
      await fs.writeFile(path.join(dir, "a.txt"), "a");
      await fs.writeFile(path.join(dir, "b.txt"), "b");
      await fs.writeFile(path.join(dir, "c.txt"), "c");
      await expect(buildRepoSeedArchive(dir, { maxFiles: 2 })).rejects.toMatchObject({
        _tag: "SeedArchiveError",
        reason: "limit-exceeded",
      });
    });
  });

  it("fails loud (SeedArchiveError) when the byte cap is exceeded", async () => {
    await withTempDir("bytecap", async (dir) => {
      await fs.writeFile(path.join(dir, "big.txt"), "x".repeat(100));
      await expect(buildRepoSeedArchive(dir, { maxBytes: 10 })).rejects.toMatchObject({
        _tag: "SeedArchiveError",
        reason: "limit-exceeded",
      });
    });
  });
});
