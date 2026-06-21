#!/usr/bin/env node
/**
 * classify-upstream.ts
 *
 * Inventory and classify upstream `pingdotgg/t3code` commits since the last
 * recorded sync baseline, producing a draft Port / Skip / Defer / Watch table
 * for human review.
 *
 * This is the inventory + classify step of the upstream-sync runbook. It does
 * not merge, push, or mutate anything — it only reads git state and FORK.md.
 *
 * Usage:
 *   node .agents/skills/upstream-sync/scripts/classify-upstream.ts
 *   node .agents/skills/upstream-sync/scripts/classify-upstream.ts --since-scan --out sync-plan.md
 *   node .agents/skills/upstream-sync/scripts/classify-upstream.ts --base <sha>
 *   node .agents/skills/upstream-sync/scripts/classify-upstream.ts --out sync-plan.md
 *   node .agents/skills/upstream-sync/scripts/classify-upstream.ts --json
 *
 * Baseline resolution (first match wins):
 *   1. --base <sha> flag
 *   2. `Upstream tip SHA:` (or legacy `Upstream SHA:`) in FORK.md
 *   3. git merge-base main upstream/main (skipped when --since-scan is set)
 *
 * Output goes to stdout by default. Use --out to write a markdown file (prints
 * its path to stdout). Use --json for machine-readable output.
 *
 * See `.agents/skills/upstream-sync/SKILL.md` for the full workflow.
 */

// @effect-diagnostics nodeBuiltinImport:off
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { readLastSyncBaseline } from "./fork-baseline.ts";
import { classifyCommit, type CommitVerdict, type UpstreamCommit } from "./rules.ts";

const SCRIPT_ROOT = ".agents/skills/upstream-sync/scripts";

interface CliArgs {
  base: string | undefined;
  out: string | undefined;
  json: boolean;
  sinceScan: boolean;
  help: boolean;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const args: CliArgs = {
    base: undefined,
    out: undefined,
    json: false,
    sinceScan: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") args.base = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--since-scan") args.sinceScan = true;
    else if (arg === "-h" || arg === "--help") args.help = true;
  }
  return args;
}

function git(args: ReadonlyArray<string>): string {
  return execFileSync("git", args as string[], { encoding: "utf8" }).trim();
}

function listUpstreamCommits(base: string): ReadonlyArray<UpstreamCommit> {
  const range = `${base}..upstream/main`;
  const log = git([
    "log",
    "--no-merges",
    `--format=%H%x09%an%x09%ad%x09%s`,
    "--date=short",
    "--reverse",
    range,
  ]);

  return log
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split("\t");
      const sha = parts[0];
      const author = parts[1];
      const date = parts[2];
      const subject = parts[3];
      if (
        sha === undefined ||
        author === undefined ||
        date === undefined ||
        subject === undefined
      ) {
        throw new Error(`Unexpected git log line (expected 4 tab fields): ${line}`);
      }
      const files = git(["show", "--name-status", "--format=", sha])
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
          const fileParts = line.split("\t");
          const status = fileParts[0];
          const path = fileParts[fileParts.length - 1];
          if (status === undefined || path === undefined) {
            throw new Error(`Unexpected name-status line: ${line}`);
          }
          return [status, path] as const;
        });
      return { sha, author, date, subject, files } satisfies UpstreamCommit;
    });
}

function resolveBase(args: CliArgs, forkMdPath: string): string {
  if (args.base) return args.base;
  const fromFork = readLastSyncBaseline(forkMdPath);
  if (fromFork) return fromFork;
  if (args.sinceScan) {
    process.stderr.write(
      "error: --since-scan requires 'Upstream tip SHA:' (or legacy 'Upstream SHA:') in FORK.md; use --base to override.\n",
    );
    process.exit(1);
  }
  const mb = git(["merge-base", "main", "upstream/main"]);
  process.stderr.write(
    `warn: no upstream scan baseline in FORK.md; falling back to merge-base ${mb}\n`,
  );
  return mb;
}

function summarize(verdicts: ReadonlyArray<CommitVerdict>): {
  byClass: Record<string, number>;
  total: number;
} {
  const byClass: Record<string, number> = {
    port: 0,
    skip: 0,
    defer: 0,
    watch: 0,
    review: 0,
  };
  for (const v of verdicts) byClass[v.classification] = (byClass[v.classification] ?? 0) + 1;
  return { byClass, total: verdicts.length };
}

function renderMarkdown(
  base: string,
  upstreamTip: string,
  verdicts: ReadonlyArray<CommitVerdict>,
): string {
  const { byClass, total } = summarize(verdicts);
  const lines: string[] = [];
  lines.push(`# Upstream sync plan`);
  lines.push("");
  lines.push(`- Base (last scan): \`${base}\``);
  lines.push(`- Upstream tip: \`${upstreamTip}\``);
  lines.push(`- Commits since base: ${total}`);
  lines.push(
    `- Draft classification: ${byClass.port ?? 0} port · ${byClass.skip ?? 0} skip · ${byClass.defer ?? 0} defer · ${byClass.watch ?? 0} watch · ${byClass.review ?? 0} review`,
  );
  lines.push("");
  lines.push(
    `> Draft produced by \`node ${SCRIPT_ROOT}/classify-upstream.ts\`. Every verdict is a starting point for human review, not a final decision. Confirm Port/Skip/Defer/Watch before porting.`,
  );
  lines.push("");

  const groups: Array<[string, string]> = [
    ["port", "### Port"],
    ["watch", "### Watch"],
    ["defer", "### Defer (project-phase-tied, see docs/specs/deferred-work.md)"],
    ["review", "### Review (assign Port / Skip / Defer / Watch)"],
    ["skip", "### Skip"],
  ];

  for (const [cls, heading] of groups) {
    const items = verdicts.filter((v) => v.classification === cls);
    if (items.length === 0) continue;
    lines.push(heading);
    lines.push("");
    lines.push("| Commit | Subject | Rationale |");
    lines.push("| --- | --- | --- |");
    for (const v of items) {
      const short = v.commit.sha.slice(0, 10);
      const subject = v.commit.subject.replace(/\|/g, "\\|");
      const rationale = v.rationale.replace(/\|/g, "\\|");
      lines.push(`| \`${short}\` | ${subject} | ${rationale} |`);
    }
    lines.push("");
  }

  lines.push(`## Conflicts to expect`);
  lines.push("");
  lines.push(
    `Before porting a cluster, run \`node ${SCRIPT_ROOT}/conflict-zones.ts --commits <sha1>,<sha2>\` to intersect upstream-touched paths with fork-modified files and FORK.md high-conflict zones.`,
  );
  lines.push("");

  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      [
        "Usage: classify-upstream.ts [--base <sha>] [--since-scan] [--out <path>] [--json]",
        "",
        "Inventories upstream commits since the last scan baseline and produces a",
        "draft Port/Skip/Defer/Watch classification. Read-only — no merges.",
        "",
        "Baseline: --base flag, else FORK.md scan SHA, else merge-base.",
        "  --since-scan  require FORK.md baseline (no merge-base fallback)",
      ].join("\n") + "\n",
    );
    return;
  }

  const forkMdPath = "FORK.md";
  const base = resolveBase(args, forkMdPath);
  const upstreamTip = git(["rev-parse", "upstream/main"]);

  process.stderr.write(`Base:  ${base}\n`);
  process.stderr.write(`Tip:   ${upstreamTip}\n`);
  process.stderr.write(`Fetching upstream refs...\n`);
  git(["fetch", "upstream", "--tags"]);

  const commits = listUpstreamCommits(base);
  process.stderr.write(`Found ${commits.length} commit(s) since base.\n`);

  const verdicts = commits.map((c) => classifyCommit(c));

  if (args.json) {
    const payload = {
      base,
      upstreamTip,
      total: verdicts.length,
      summary: summarize(verdicts).byClass,
      verdicts,
    };
    const json = JSON.stringify(payload, null, 2);
    if (args.out) {
      writeFileSync(args.out, json + "\n");
      process.stdout.write(args.out + "\n");
    } else {
      process.stdout.write(json + "\n");
    }
    return;
  }

  const markdown = renderMarkdown(base, upstreamTip, verdicts);
  if (args.out) {
    writeFileSync(args.out, markdown + "\n");
    process.stdout.write(args.out + "\n");
  } else {
    process.stdout.write(markdown + "\n");
  }
}

main();
