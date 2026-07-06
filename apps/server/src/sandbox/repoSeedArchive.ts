/**
 * `repoSeedArchive` — build a bounded POSIX tar archive of a repo working tree
 * for seeding into a sandbox at `/workspace` (Phase 2).
 *
 * The seed is a bounded working-tree copy, not a clone: it skips the Jujutsu
 * metadata dir (`.jj`) and `node_modules`, honors `.gitignore`, and enforces a
 * concrete cap (default 256 MB / 50k files) that fails loud rather than silently
 * truncating. `.git` is included so the seeded repo carries its remote URL and
 * the sandbox server's `RepositoryIdentityResolver` resolves the same
 * `canonicalKey` as the host repo, letting sandbox projects group with the
 * same repo on other environments. Only regular files are packed (directories
 * are implied by file paths; symlinks are skipped for Phase 2 simplicity).
 *
 * No external tar dependency exists in the repo and Node ships no `tar`
 * module, so a minimal ustar writer is shared from `ustarWriter.ts`. Docker's
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
import * as path from "node:path";

import * as Data from "effect/Data";

import { packUstarArchive } from "./ustarWriter.ts";

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
  readonly mode: number;
}

/**
 * Build a bounded ustar tar archive of the regular files under `repoRoot`.
 * Skips `.jj`/`node_modules` components (`.git` is included so the seeded
 * repo carries its remote URL for repo-identity grouping), honors a
 * `.gitignore` subset, and fails loud when `maxBytes` (default 256 MB) or
 * `maxFiles` (default 50k) is exceeded. Returns the archive as a `Uint8Array`
 * (Docker accepts an uncompressed tar for `PUT /containers/{id}/archive`).
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
  return await packUstarArchive(selected).catch((cause) => {
    if (cause instanceof SeedArchiveError) throw cause;
    // The shared ustar writer throws plain Error for path-overflow / read
    // failures; wrap them in SeedArchiveError so callers get the typed error.
    throw new SeedArchiveError({
      reason: "read-failed",
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  });
}

// ── File selection (bounded walk + .gitignore subset) ────────────────

/** Path components that are always skipped (Jujutsu metadata + deps). */
const SKIP_COMPONENTS = new Set([".jj", "node_modules"]);

/**
 * Recursively walk `root` and select regular files, skipping
 * `.jj`/`node_modules` components and `.gitignore`-matched paths.
 * `.git` is included so the seeded repo carries its remote URL and
 * `RepositoryIdentityResolver` (`git rev-parse`/`git remote -v`) resolves the
 * same `canonicalKey` as the host repo, letting sandbox projects group with
 * the same repo on other environments (the env picker).
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
        stat = await fs.lstat(absolutePath);
      } catch (cause) {
        throw new SeedArchiveError({
          reason: "read-failed",
          message: `failed to stat ${absolutePath}`,
          cause,
        });
      }
      // Skip symlinks explicitly — lstat detects them without following, so
      // a symlink to ~/.ssh or an external directory is never archived/copied.
      if (stat.isSymbolicLink()) continue;
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
        selected.push({ relativePath, absolutePath, size: stat.size, mode: stat.mode & 0o777 });
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
  const suffix = dirOnly ? "/" : "(/|$)";
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
  // Last-match-wins: iterate every pattern in file order and let the final
  // matching pattern decide, with negations un-ignoring. This mirrors git's
  // precedence (a later `!` pattern overrides an earlier ignore).
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
