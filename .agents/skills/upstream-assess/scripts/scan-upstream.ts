#!/usr/bin/env node
// scan-upstream.ts — inventories upstream commits since the last scan baseline.
//
// Part of the upstream-assess skill (ADR 0004 — selective vendor-pull).
// Read-only: runs git, writes a markdown report to stdout. Never pushes or merges.
//
// Run from the repo root:
//   node .agents/skills/upstream-assess/scripts/scan-upstream.ts [options] > /tmp/upstream-scan.md
//
// The baseline (last-scanned upstream tip) is read from FORK.md's
// "Last upstream scan" block. Override with --base <sha> or --tip <sha>.
// If neither FORK.md nor flags supply a base, falls back to merge-base(main, upstream/main).

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const REMOTE = "upstream";
const REMOTE_REF = "upstream/main";
const FORK_MD = "FORK.md";

function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (e: any) {
    const stderr = (e?.stderr || e?.message || "").toString().trim();
    throw new Error(`git ${args.join(" ")} failed${stderr ? ": " + stderr : ""}`, { cause: e });
  }
}

function ensureRemote(): void {
  const remotes = git("remote")
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
  if (!remotes.includes(REMOTE)) {
    console.error(
      `[scan-upstream] No "${REMOTE}" remote is configured.\n` +
        `This skill does not add it unprompted. If you want to scan, add it:\n` +
        `  git remote add ${REMOTE} https://github.com/pingdotgg/t3code.git\n` +
        `then: git fetch ${REMOTE} --tags`,
    );
    process.exit(1);
  }
  // Confirm the ref resolves before we rely on it.
  try {
    git("rev-parse", "--verify", REMOTE_REF);
  } catch {
    console.error(
      `[scan-upstream] Remote "${REMOTE}" exists but "${REMOTE_REF}" does not resolve.\n` +
        `Run: git fetch ${REMOTE} --tags`,
    );
    process.exit(1);
  }
}

// Read the last-scanned upstream tip from FORK.md, looking for either:
//   Upstream tip SHA:   <sha>
//   Last upstream scan: ... (and a nearby Upstream tip SHA)
// Also tolerates the legacy "Baseline sync point" / "Upstream SHA:" rows.
function baselineFromForkMd(): string | null {
  if (!existsSync(FORK_MD)) return null;
  const text = readFileSync(FORK_MD, "utf8");
  const tryPattern = (re: RegExp): string | null => {
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };
  return (
    tryPattern(/Upstream tip SHA:\s*([0-9a-f]{7,40})/i) ||
    tryPattern(/Upstream SHA:\s*([0-9a-f]{7,40})/i) ||
    tryPattern(/Baseline sync point\s*\|\s*`?([0-9a-f]{7,40})/i) ||
    null
  );
}

function parseArgs(argv: string[]): { base?: string; tip?: string; help?: boolean } {
  const out: { base?: string; tip?: string; help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--base") out.base = argv[++i];
    else if (a === "--tip") out.tip = argv[++i];
    else if (a?.startsWith("--base=")) out.base = a.slice("--base=".length);
    else if (a?.startsWith("--tip=")) out.tip = a.slice("--tip=".length);
  }
  return out;
}

const HELP = `Usage:
  node .agents/skills/upstream-assess/scripts/scan-upstream.ts [options]

Options:
  --base <sha>   Baseline commit (exclusive). Default: last-scanned tip from FORK.md,
                 else git merge-base main upstream/main.
  --tip <sha>    Upstream tip to scan to (default: ${REMOTE_REF}).
  -h, --help     Show this help.

Output is a markdown triage report on stdout. Redirect to a scratch file:
  node .agents/skills/upstream-assess/scripts/scan-upstream.ts > /tmp/upstream-scan.md`;

interface Commit {
  sha: string;
  subject: string;
  author: string;
  date: string; // ISO
  files: string[];
  isCodex: boolean;
}

// Area bucket from the first one or two path segments.
function areaOf(path: string): string {
  const parts = path.split("/");
  if (parts[0] === "apps" && parts.length > 1) return `apps/${parts[1]}`;
  if (parts[0] === "packages" && parts.length > 1) return `packages/${parts[1]}`;
  if (parts[0] === ".github") return ".github";
  return parts[0] || "(root)";
}

// Pull all non-merge upstream commits in (base, tip] with their changed files.
function collectCommits(base: string, tip: string): Commit[] {
  // %x00 is a NUL record separator; %x01 separates fields within a record.
  const fmt = "%H%x01%an%x01%aI%x01%s";
  const log = git("log", "--no-merges", `--pretty=format:${fmt}`, `${base}..${tip}`);
  if (!log) return [];
  const commits: Commit[] = [];
  for (const record of log.split("\n").filter(Boolean)) {
    const [sha, author, date, ...subjectParts] = record.split("\x01");
    const subject = subjectParts.join("\x01");
    if (!sha) continue;
    let files: string[] = [];
    try {
      files = git("show", "--no-color", "--no-renames", "--name-only", "--pretty=format:", sha)
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
    } catch {
      files = [];
    }
    commits.push({
      sha,
      subject,
      author,
      date,
      files,
      isCodex: /^\[codex\]/i.test(subject),
    });
  }
  return commits;
}

function buildReport(base: string, tip: string, tipSha: string): string {
  const commits = collectCommits(base, tip);
  const codex = commits.filter((c) => c.isCodex);
  const others = commits.filter((c) => !c.isCodex);

  const out: string[] = [];
  out.push(`# Upstream scan`);
  out.push("");
  out.push(`- Baseline (exclusive): \`${base}\``);
  out.push(`- Scanned tip: \`${tipSha}\`  (ref: ${tip})`);
  out.push(`- Total non-merge commits in range: **${commits.length}**`);
  out.push("");
  out.push(`Policy: [ADR 0004 — Selective vendor-pull](/docs/adrs/0004-selective-vendor-pull.md).`);
  out.push(
    `This report is a triage input, not a plan. Decisions are made per-change with the human in the loop.`,
  );
  out.push("");

  // [codex] cluster — watch by default.
  out.push(`## [codex] Effect service migration — WATCH`);
  out.push("");
  if (codex.length === 0) {
    out.push(`_No \`[codex]\`-tagged commits in this range._`);
  } else {
    out.push(
      `**${codex.length} commits.** These are coupled intermediate states of an ongoing upstream ` +
        `Effect refactor. Do not port individually — port the net result once upstream stabilizes it. ` +
        `(Stabilization trigger: upstream stops landing \`[codex]\` commits for a release cycle.)`,
    );
    out.push("");
    // Surface the files most touched by the cluster, so the human can see blast radius.
    const fileCounts = new Map<string, number>();
    for (const c of codex) for (const f of c.files) fileCounts.set(f, (fileCounts.get(f) || 0) + 1);
    const topFiles = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    if (topFiles.length) {
      out.push(`Top ${topFiles.length} most-touched files in the cluster:`);
      out.push("");
      for (const [f, n] of topFiles) out.push(`- \`${f}\` (${n})`);
      out.push("");
    }
    out.push(`Representative \`[codex]\` commits (first 15):`);
    out.push("");
    for (const c of codex.slice(0, 15)) out.push(`- \`${c.sha.slice(0, 10)}\` ${c.subject}`);
    if (codex.length > 15) out.push(`- ... and ${codex.length - 15} more`);
    out.push("");
  }

  // Non-codex changes, grouped by area.
  out.push(`## Non-[codex] changes — triage candidates`);
  out.push("");
  if (others.length === 0) {
    out.push(
      `_No non-\`[codex]\` commits in this range. The only upstream activity is the Effect migration._`,
    );
    out.push("");
    return out.join("\n");
  }

  const byArea = new Map<string, Commit[]>();
  for (const c of others) {
    // A commit may touch many areas; bucket by the primary (first changed file's area),
    // which is usually the dominant one and keeps each commit in one bucket.
    const primary = c.files[0] ? areaOf(c.files[0]) : "(no files)";
    if (!byArea.has(primary)) byArea.set(primary, []);
    byArea.get(primary)!.push(c);
  }

  const sortedAreas = [...byArea.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [area, areaCommits] of sortedAreas) {
    out.push(`### ${area} (${areaCommits.length})`);
    out.push("");
    for (const c of areaCommits) {
      const dateShort = c.date.slice(0, 10);
      out.push(`- \`${c.sha.slice(0, 10)}\` (${dateShort}) ${c.subject}`);
    }
    out.push("");
  }

  out.push(`## How to triage`);
  out.push("");
  out.push("For each candidate, run the intersection script to see fork-modified files touched:");
  out.push("```bash");
  out.push("node .agents/skills/upstream-assess/scripts/intersection.ts <sha>");
  out.push("node .agents/skills/upstream-assess/scripts/intersection.ts <base>..<tip>");
  out.push("```");
  out.push("Then assign: Port / Skip / Defer / Watch. See the upstream-assess SKILL.md Phase 2.");
  out.push("");

  return out.join("\n");
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  ensureRemote();

  const tip = opts.tip || REMOTE_REF;
  let tipSha: string;
  try {
    tipSha = git("rev-parse", tip);
  } catch {
    console.error(
      `[scan-upstream] Could not resolve tip "${tip}". Run: git fetch ${REMOTE} --tags`,
    );
    process.exit(1);
  }

  // Resolve base: flag → FORK.md → merge-base(main, upstream/main).
  let base = opts.base || baselineFromForkMd();
  if (!base) {
    try {
      base = git("merge-base", "main", REMOTE_REF);
      console.error(
        `[scan-upstream] No baseline in FORK.md; using merge-base(main, ${REMOTE_REF}) = ${base}`,
      );
    } catch {
      console.error(
        `[scan-upstream] Could not determine a baseline. Supply --base <sha> ` +
          `(the last upstream tip you scanned).`,
      );
      process.exit(1);
    }
  }

  let baseSha: string;
  try {
    baseSha = git("rev-parse", base);
  } catch {
    console.error(`[scan-upstream] Base "${base}" does not resolve to a commit.`);
    process.exit(1);
  }

  // Sanity: base must be an ancestor of tip for the range to make sense.
  try {
    const isAncestor = git("merge-base", "--is-ancestor", baseSha, tipSha);
    if (isAncestor !== "") {
      // merge-base --is-ancestor prints nothing and exits 0 when ancestor; non-zero otherwise.
    }
  } catch {
    console.error(
      `[scan-upstream] Base ${baseSha} is not an ancestor of tip ${tipSha}.\n` +
        `The baseline in FORK.md may be stale or wrong. Check the "Last upstream scan" block.`,
    );
    process.exit(1);
  }

  process.stdout.write(buildReport(baseSha, tipSha, tip));
}

main();
