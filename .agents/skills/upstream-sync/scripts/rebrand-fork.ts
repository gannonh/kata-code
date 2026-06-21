#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
/**
 * rebrand-fork.ts
 *
 * Restores Kata Code branding after an upstream merge by applying the
 * identity-rename table from FORK.md across the working tree.
 *
 * Upstream merges reintroduce `@t3tools/*` package names, `T3CODE_*` env/build
 * constants, and `__T3CODE_*` build defines because those strings predate the
 * fork's rename. This script applies the renames deterministically so the
 * result is auditable and repeatable across syncs.
 *
 * Read-only inspection by default (prints a report of what would change).
 * Pass `--apply` to write changes. Pass `--check` to exit non-zero if any
 * fork-identity regressions remain (use as a closure gate in Step 6).
 *
 * Usage:
 *   node .agents/skills/upstream-sync/scripts/rebrand-fork.ts            # report
 *   node .agents/skills/upstream-sync/scripts/rebrand-fork.ts --apply    # rewrite
 *   node .agents/skills/upstream-sync/scripts/rebrand-fork.ts --check     # gate
 *
 * Excludes node_modules, .repos/, .git/, patches/, the docs+FORK.md sources
 * that legitimately document the rename, and this skill directory itself.
 *
 * The rename table is the source of truth from FORK.md "Identity map" /
 * "npm package naming". Edit this table only when fork identity changes.
 *
 * Intentionally does NOT rename the internal `t3://` static-asset scheme —
 * per FORK.md that stays upstream-shaped as a deferred Phase 2 item.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Package-name renames. Each entry: [from, to, category].
 *
 * Order matters: longer specifiers must come first so
 * `@t3tools/mobile-terminal-native` is rewritten before `@t3tools/mobile`
 * would partially match it. All entries are anchored to the `@t3tools/`
 * package boundary via plain-string split/join, so a bare "mobile" in prose
 * is never touched.
 *
 * Source: FORK.md "npm package naming (`@kata-sh/code`)" table.
 */
const PACKAGE_RENAMES: ReadonlyArray<readonly [string, string, string]> = [
  // Longest first to avoid partial-match: mobile-native variants before plain mobile.
  ["@t3tools/mobile-review-diff-native", "@kata-sh/code-mobile-review-diff-native", "package"],
  ["@t3tools/mobile-terminal-native", "@kata-sh/code-mobile-terminal-native", "package"],
  ["@t3tools/oxlint-plugin-t3code", "@kata-sh/code-oxlint-plugin", "package"],
  ["@t3tools/client-runtime", "@kata-sh/code-client-runtime", "package"],
  ["@t3tools/monorepo", "@kata-sh/code-monorepo", "package"],
  ["@t3tools/marketing", "@kata-sh/code-marketing", "package"],
  ["@t3tools/contracts", "@kata-sh/code-contracts", "package"],
  ["@t3tools/tailscale", "@kata-sh/code-tailscale", "package"],
  ["@t3tools/scripts", "@kata-sh/code-scripts", "package"],
  ["@t3tools/desktop", "@kata-sh/code-desktop", "package"],
  ["@t3tools/mobile", "@kata-sh/code-mobile", "package"],
  ["@t3tools/shared", "@kata-sh/code-shared", "package"],
  ["@t3tools/ssh", "@kata-sh/code-ssh", "package"],
  ["@t3tools/web", "@kata-sh/code-web", "package"],
];

/**
 * The `t3` server package is special: it becomes `@kata-sh/code-cli`. Match
 * it only as a quoted package dependency, not as a bare token, to avoid
 * rewriting unrelated "t3" occurrences.
 */
const T3_SERVER_PACKAGE_SKIP_PATHS: ReadonlyArray<RegExp> = [
  /^apps\/desktop\/src\/electron\/ElectronProtocol\.ts$/,
  /^apps\/desktop\/src\/electron\/ElectronProtocol\.test\.ts$/,
];

const T3_SERVER_PACKAGE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/"t3"/g, '"@kata-sh/code-cli"'],
  [/'t3'/g, "'@kata-sh/code-cli'"],
];

/**
 * Exact-match string renames applied via plain split/join. Covers build-time
 * defines (vite/electron injection), the Context.Service deterministic-key
 * prefixes the package renames above don't reach, and OTel service/attribute
 * names upstream reintroduces in fork-shaped form.
 *
 * Order constraint: no entry may be a prefix of a later one (split/join is
 * greedy per entry). The current set is mutually non-overlapping.
 */
const IDENTITY_RENAMES: ReadonlyArray<readonly [string, string, string]> = [
  [
    "__T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__",
    "__KATACODE_BUILD_CLERK_PUBLISHABLE_KEY__",
    "build define",
  ],
  // Context.Service deterministic-key prefixes: apps/server (`t3` -> @kata-sh/code-cli)
  // and infra/relay (`t3code-relay` -> @kata-sh/code-relay).
  ['"t3/', '"@kata-sh/code-cli/', "service key"],
  ['"t3code-relay/', '"@kata-sh/code-relay/', "service key"],
  // OTel service + attribute names reintroduced upstream in fork-shaped form.
  ['"t3.client.surface"', '"kata.client.surface"', "otel"],
  ['"t3-headless-relay-client"', '"kata-headless-relay-client"', "otel"],
  ['"t3-server"', '"kata-server"', "otel"],
];

/**
 * Env-var prefix renames use a regex (word boundary) so `T3CODE_FOO` becomes
 * `KATACODE_FOO` without touching `T3CODE` inside another token.
 */
const ENV_PREFIX_PATTERN: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bT3CODE_([A-Z0-9_]+)/g, "KATACODE_$1"],
];

/**
 * Property/identifier renames the plain-string rules can't make safely.
 * Word-boundary anchored so partial tokens (e.g. `something.t3`) are untouched.
 *   t3Home  -> katacodeHome  (state-dir config property)
 *   t3-env: -> kata-env:     (JWT issuer prefix)
 *   ~/.t3   -> ~/.katacode   (state-dir literal, anchored to leading `~`)
 */
const PROPERTY_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bt3Home\b/g, "katacodeHome"],
  [/t3-env:/g, "kata-env:"],
  [/~\/\.t3\b/g, "~/.katacode"],
];

interface CliArgs {
  apply: boolean;
  check: boolean;
  help: boolean;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const args: CliArgs = { apply: false, check: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--check") args.check = true;
    else if (arg === "-h" || arg === "--help") args.help = true;
  }
  return args;
}

/**
 * Files the rebrand must never touch. Documenting the rename (FORK.md, docs/);
 * vendored read-only (.repos/); install artifacts (node_modules, pnpm-lock);
 * patch files with their own naming; this skill directory.
 */
const EXCLUDE_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\/)node_modules\//,
  /(^|\/)\.repos\//,
  /(^|\/)\.git\//,
  /(^|\/)patches\//,
  /(^|\/)\.agents\/skills\/upstream-sync\//,
  /^FORK\.md$/,
  /^AGENTS\.md$/,
  /(^|\/)docs\//,
  /(^|\/)\.macroscope\//,
  /pnpm-lock\.yaml$/,
];

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".html",
  ".css",
  ".scss",
  ".toml",
  ".env",
  ".example",
  ".sh",
  ".xml",
  ".plist",
  "",
]);

function git(args: ReadonlyArray<string>): string {
  return execFileSync("git", args as string[], { encoding: "utf8" }).trim();
}

/** Read tracked text files, excluding the patterns above. */
function listTrackedTextFiles(): ReadonlyArray<string> {
  const all = git(["ls-files"]);
  return all
    .split("\n")
    .filter((line) => line.length > 0)
    .filter((path) => !EXCLUDE_PATTERNS.some((p) => p.test(path)))
    .filter((path) => {
      const dot = path.lastIndexOf(".");
      const ext = dot === -1 ? "" : path.slice(dot);
      return TEXT_EXTENSIONS.has(ext);
    });
}

interface RenameHit {
  readonly from: string;
  readonly to: string;
  readonly category: string;
  readonly count: number;
}

function applyStringRenames(
  content: string,
  renames: ReadonlyArray<readonly [string, string, string]>,
): { rewritten: string; hits: Array<RenameHit> } {
  let rewritten = content;
  const hits: Array<RenameHit> = [];

  for (const [from, to, category] of renames) {
    if (!rewritten.includes(from)) continue;
    const count = rewritten.split(from).length - 1;
    rewritten = rewritten.split(from).join(to);
    hits.push({ from, to, category, count });
  }

  return { rewritten, hits };
}

function applyPatternRenames(
  content: string,
  patterns: ReadonlyArray<readonly [RegExp, string]>,
  category: string,
): { rewritten: string; hits: Array<RenameHit> } {
  let rewritten = content;
  const hits: Array<RenameHit> = [];

  for (const [pattern, to] of patterns) {
    pattern.lastIndex = 0;
    const matches = rewritten.match(pattern);
    if (!matches) continue;
    rewritten = rewritten.replace(pattern, to);
    hits.push({ from: pattern.source, to, category, count: matches.length });
  }

  return { rewritten, hits };
}

function applyToContent(
  content: string,
  filePath?: string,
): { rewritten: string; hits: Array<RenameHit> } {
  const packageResult = applyStringRenames(content, PACKAGE_RENAMES);
  const skipT3ServerPackageRenames =
    filePath !== undefined &&
    T3_SERVER_PACKAGE_SKIP_PATHS.some((pattern) => pattern.test(filePath));
  const t3ServerResult = skipT3ServerPackageRenames
    ? { rewritten: packageResult.rewritten, hits: [] as Array<RenameHit> }
    : applyPatternRenames(
        packageResult.rewritten,
        T3_SERVER_PACKAGE_PATTERNS,
        "package (t3 server)",
      );
  const identityResult = applyStringRenames(t3ServerResult.rewritten, IDENTITY_RENAMES);
  const envResult = applyPatternRenames(
    identityResult.rewritten,
    ENV_PREFIX_PATTERN,
    "env prefix T3CODE_*",
  );
  const propertyResult = applyPatternRenames(
    envResult.rewritten,
    PROPERTY_PATTERNS,
    "property/identifier",
  );

  return {
    rewritten: propertyResult.rewritten,
    hits: [
      ...packageResult.hits,
      ...t3ServerResult.hits,
      ...identityResult.hits,
      ...envResult.hits,
      ...propertyResult.hits,
    ],
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && args.check) {
    process.stderr.write("Use either --apply or --check in a single invocation.\n");
    process.exit(2);
  }
  if (args.help) {
    process.stdout.write(
      [
        "Usage: rebrand-fork.ts [--apply] [--check]",
        "",
        "Restores Kata Code branding after an upstream merge by applying the",
        "FORK.md identity-rename table. Default: report only (no writes).",
        "  --apply   rewrite files in place",
        "  --check   exit 1 if any fork-identity regressions remain (closure gate)",
        "",
        "Rename scope: @t3tools/* packages, the `t3` server package, T3CODE_* env",
        "and build constants, Context.Service key prefixes, OTel service/attribute",
        "names, and the t3Home / t3-env: / ~/.t3 property literals. Does NOT rename",
        "the internal t3:// static-asset scheme (deferred Phase 2 per FORK.md).",
      ].join("\n") + "\n",
    );
    return;
  }

  const files = listTrackedTextFiles();
  const allHits: Array<RenameHit & { path: string }> = [];
  let changedFiles = 0;
  let totalReplacements = 0;

  for (const path of files) {
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const { rewritten, hits } = applyToContent(content, path);
    if (hits.length === 0) continue;
    changedFiles += 1;
    for (const h of hits) {
      allHits.push({ ...h, path });
      totalReplacements += h.count;
    }
    if (args.apply && rewritten !== content) {
      writeFileSync(path, rewritten);
    }
  }

  if (args.check) {
    if (allHits.length > 0) {
      process.stderr.write(
        `rebrand-fork --check: ${totalReplacements} regression(s) across ${changedFiles} file(s) remain.\n`,
      );
      process.stderr.write(
        "Run `node .agents/skills/upstream-sync/scripts/rebrand-fork.ts --apply` to fix, then re-check.\n",
      );
      process.exit(1);
    }
    process.stdout.write("rebrand-fork --check: no fork-identity regressions found.\n");
    process.exit(0);
  }

  const action = args.apply ? "Applied" : "Would apply";
  process.stdout.write(
    `${action} ${totalReplacements} replacement(s) across ${changedFiles} file(s).\n\n`,
  );

  const byCategory = new Map<string, number>();
  for (const h of allHits) {
    byCategory.set(h.category, (byCategory.get(h.category) ?? 0) + h.count);
  }
  process.stdout.write("By category:\n");
  for (const [cat, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${cat}: ${count}\n`);
  }

  if (!args.apply && totalReplacements > 0) {
    process.stdout.write("\nThis was a dry run. Re-run with --apply to write changes.\n");
  }
}

main();
