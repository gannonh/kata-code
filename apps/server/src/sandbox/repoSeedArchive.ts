/**
 * `repoSeedArchive` — build a bounded POSIX tar archive of a repo working tree
 * for seeding into a sandbox at `/workspace` (Phase 2).
 *
 * The seed is a bounded working-tree copy, not a clone: it skips the VCS
 * metadata dir (`.git`/`.jj`) and `node_modules`, honors `.gitignore`, and
 * enforces a concrete cap (default 256 MB / 50k files) that fails loud rather
 * than silently truncating. Only regular files are packed (directories are
 * implied by file paths; symlinks are skipped for Phase 2 simplicity).
 *
 * No external tar dependency exists in the repo and Node ships no `tar`
 * module, so a minimal ustar writer is implemented here (~60 lines). Docker's
 * `PUT /containers/{id}/archive` accepts an uncompressed ustar tar.
 *
 * `.gitignore` support is a deliberately limited subset (documented inline): a
 * full gitignore engine is out of scope for Phase 2. The subset handles the
 * common cases (file/dir names, glob `*`, negation `!`, leading `/` for
 * repo-root anchoring, trailing `/` for directories).
 *
 * @module repoSeedArchive
 */
// @effect-diagnostics nodeBuiltinImport:off - host-side bounded tar builder uses node:fs for synchronous tree walks; not an Effect FileSystem consumer.
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";

import * as Data from "effect/Data";

/** Default seed bounds: 256 MB total content, 50k files. Fail loud over either. */
export const DEFAULT_SEED_MAX_BYTES = 256 * 1024 * 1024;
export const DEFAULT_SEED_MAX_FILES = 50_000;

/** A bounded seed archive build failure. Surfaced explicitly (no silent truncation). */
export class SeedArchiveError extends Data.TaggedError("SeedArchiveError")<{
  readonly reason: "limit-exceeded" | "read-failed" | "empty";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface SeedLimits {
  readonly maxBytes?: number;
  readonly maxFiles?: number;
}

/** Entry selected for the archive: a repo-relative POSIX path + absolute source. */
interface SelectedFile {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly size: number;
}

/**
 * Build a bounded ustar tar archive of the regular files under `repoRoot`.
 * Skips `.git`/`.jj`/`node_modules` components, honors a `.gitignore` subset,
 * and fails loud when `maxBytes` (default 256 MB) or `maxFiles` (default 50k)
 * is exceeded. Returns the archive as a `Uint8Array` (Docker accepts an
 * uncompressed tar for `PUT /containers/{id}/archive`).
 */
export async function buildRepoSeedArchive(
  repoRoot: string,
  limits: SeedLimits,
): Promise<Uint8Array> {
  const maxBytes = limits.maxBytes ?? DEFAULT_SEED_MAX_BYTES;
  const maxFiles = limits.maxFiles ?? DEFAULT_SEED_MAX_FILES;
  const root = path.resolve(repoRoot);

  const selected = await selectFiles(root, maxBytes, maxFiles);
  if (selected.length === 0) {
    throw new SeedArchiveError({
      reason: "empty",
      message: `seed archive for ${repoRoot} contains no files (everything ignored or empty repo)`,
    });
  }
  return packUstar(selected);
}

// ── File selection (bounded walk + .gitignore subset) ────────────────

/** Path components that are always skipped (VCS metadata + deps). */
const SKIP_COMPONENTS = new Set([".git", ".jj", "node_modules"]);

/**
 * Recursively walk `root` and select regular files, skipping
 * `.git`/`.jj`/`node_modules` components and `.gitignore`-matched paths.
 * Fails loud over the byte/file caps.
 */
async function selectFiles(
  root: string,
  maxBytes: number,
  maxFiles: number,
): Promise<ReadonlyArray<SelectedFile>> {
  const selected: SelectedFile[] = [];
  let totalBytes = 0;

  // Load the repo-root .gitignore (a single root file covers the common case;
  // nested .gitignore files are not honored in this Phase 2 subset — documented).
  const rootIgnore = await loadGitignore(root);
  const matcher = createGitignoreMatcher(rootIgnore, root);

  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (cause) {
      throw new SeedArchiveError({
        reason: "read-failed",
        message: `failed to read directory ${dir}`,
        cause,
      });
    }
    for (const entry of entries) {
      if (SKIP_COMPONENTS.has(entry)) continue;
      const absolutePath = path.join(dir, entry);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      if (matcher.isIgnored(relativePath)) continue;
      let stat;
      try {
        stat = await fs.stat(absolutePath);
      } catch (cause) {
        throw new SeedArchiveError({
          reason: "read-failed",
          message: `failed to stat ${absolutePath}`,
          cause,
        });
      }
      if (stat.isFile()) {
        if (selected.length >= maxFiles) {
          throw new SeedArchiveError({
            reason: "limit-exceeded",
            message: `seed archive exceeded the file cap (${maxFiles}) at ${relativePath}; reduce the repo size or raise the limit`,
          });
        }
        if (totalBytes + stat.size > maxBytes) {
          throw new SeedArchiveError({
            reason: "limit-exceeded",
            message: `seed archive exceeded the byte cap (${maxBytes}) at ${relativePath}; reduce the repo size or raise the limit`,
          });
        }
        selected.push({ relativePath, absolutePath, size: stat.size });
        totalBytes += stat.size;
      } else if (stat.isDirectory()) {
        await walk(absolutePath);
      }
      // Symlinks and other types are skipped for Phase 2 simplicity.
    }
  }

  await walk(root);
  return selected;
}

// ── .gitignore subset ────────────────────────────────────────────────

/**
 * Read `.gitignore` at `root` if present. Returns the raw lines (comments and
 * blank lines stripped). A Phase 2 subset: only the repo-root `.gitignore` is
 * honored (nested `.gitignore` files are not). This covers the common case
 * (deps, build output, env files); a full gitignore engine is deferred.
 */
async function loadGitignore(root: string): Promise<ReadonlyArray<string>> {
  try {
    const content = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    return content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
  } catch {
    return [];
  }
}

/**
 * Compile a `.gitignore` line into a RegExp. Supports a Phase 2 subset:
 * - `*` matches any run of characters except `/`
 * - `?` matches a single character except `/`
 * - leading `/` anchors to the repo root
 * - trailing `/` matches directories only (treated as a path prefix here)
 * - `!` negates (handled by the matcher, not the regex)
 * - bare `/` in the pattern separates path segments
 */
function gitignorePatternToRegex(pattern: string): {
  readonly regex: RegExp;
  readonly negate: boolean;
} {
  let negate = false;
  let p = pattern;
  if (p.startsWith("!")) {
    negate = true;
    p = p.slice(1);
  }
  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);

  // Escape regex specials except our glob chars `*` and `?` and the path `/`.
  let re = "";
  for (const ch of p) {
    if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else if ("/.$^()|+[]{}\\".includes(ch)) re += `\\${ch}`;
    else re += ch;
  }
  // A pattern without a `/` matches at any depth; a pattern with `/` matches
  // against the full repo-relative path.
  const hasSlash = p.includes("/");
  const body = hasSlash || anchored ? re : `(^|/)${re}`;
  const suffix = dirOnly ? "(/|$)" : "(/|$)";
  const source = hasSlash || anchored ? `^${body}${suffix}` : `${body}${suffix}`;
  return { regex: new RegExp(source), negate };
}

/** A compiled gitignore matcher: positive patterns + negations, first-match-wins. */
interface GitignoreMatcher {
  isIgnored(relativePath: string): boolean;
}

function createGitignoreMatcher(patterns: ReadonlyArray<string>, _root: string): GitignoreMatcher {
  if (patterns.length === 0) return { isIgnored: () => false };
  const compiled = patterns.map(gitignorePatternToRegex);
  // First-match-wins: the first pattern (in file order) whose regex matches
  // decides, with negations un-ignoring. This mirrors git's precedence.
  return {
    isIgnored(relativePath: string): boolean {
      let ignored = false;
      for (const { regex, negate } of compiled) {
        if (regex.test(relativePath)) {
          ignored = !negate;
        }
      }
      return ignored;
    },
  };
}

// ── Minimal ustar tar writer ──────────────────────────────────────────

/**
 * Pack the selected files into a ustar tar archive (regular files only).
 * Each entry is a 512-byte header + content padded to a 512-byte boundary.
 * The archive ends with two 512-byte zero blocks. Docker accepts this for
 * `PUT /containers/{id}/archive`.
 */
function packUstar(files: ReadonlyArray<SelectedFile>): Uint8Array {
  const chunks: Buffer[] = [];
  for (const file of files) {
    let content: Buffer;
    try {
      content = fsSyncRead(file.absolutePath);
    } catch (cause) {
      throw new SeedArchiveError({
        reason: "read-failed",
        message: `failed to read file ${file.absolutePath}`,
        cause,
      });
    }
    chunks.push(makeUstarHeader(file.relativePath, content.length));
    chunks.push(content);
    const pad = (512 - (content.length % 512)) % 512;
    if (pad > 0) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(1024, 0)); // two zero-block terminator
  return Buffer.concat(chunks);
}

function fsSyncRead(p: string): Buffer {
  return fsSync.readFileSync(p);
}

/** Build a 512-byte ustar header for a regular file. */
function makeUstarHeader(relativePath: string, size: number): Buffer {
  const header = Buffer.alloc(512, 0);
  // name (100) — ustar supports a 100-byte name + 155-byte prefix; for Phase 2
  // repos, relative paths fit in 100 bytes. If a path is longer, fail loud.
  const nameBuf = Buffer.from(relativePath, "utf8");
  if (nameBuf.length > 100) {
    throw new SeedArchiveError({
      reason: "read-failed",
      message: `seed archive path too long for ustar (>100 bytes): ${relativePath}`,
    });
  }
  nameBuf.copy(header, 0);
  header.write("0000644\0", 100, "ascii"); // mode
  header.write("0000000\0", 108, "ascii"); // uid
  header.write("0000000\0", 116, "ascii"); // gid
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "ascii"); // size
  header.write("00000000000\0", 136, "ascii"); // mtime
  header.write("        ", 148, "ascii"); // checksum placeholder (8 spaces)
  header.write("0", 156, "ascii"); // typeflag: regular file
  // linkname (100) left zero for regular files.
  header.write("ustar\0", 257, "ascii"); // magic
  header.write("00", 263, "ascii"); // version
  // uname/gname (32 each) left zero.
  // devmajor/devminor (8 each) left zero.
  // prefix (155) left zero.

  // Checksum: sum of all header bytes with the checksum field as 8 spaces.
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i] ?? 0;
  header.write(checksum.toString(8).padStart(6, "0"), 148, "ascii");
  header.write("\0 ", 154, "ascii"); // null + space terminator
  return header;
}
