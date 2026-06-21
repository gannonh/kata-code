#!/usr/bin/env node
/**
 * conflict-zones.ts
 *
 * Predict where an upstream merge will conflict by intersecting:
 *   1. paths upstream touched since the last sync baseline (or a commit cluster)
 *   2. paths the fork has modified since that same baseline
 *   3. the FORK.md high-conflict zone catalog
 *
 * The intersection of (1) and (2) is the real conflict surface: a file only
 * one side changed does not conflict. The FORK.md zones in (3) are the
 * remembered high-blast-radius areas (contracts, shared, server, web, desktop,
 * dev-runner, lockfile, package.json) — when those appear in the intersection,
 * they get a higher signal flag.
 *
 * Read-only. No merges, no writes outside --out.
 *
 * Usage:
 *   node .agents/skills/upstream-sync/scripts/conflict-zones.ts
 *   node .agents/skills/upstream-sync/scripts/conflict-zones.ts --base <sha>
 *   node .agents/skills/upstream-sync/scripts/conflict-zones.ts --commits <sha1>,<sha2>
 *   node .agents/skills/upstream-sync/scripts/conflict-zones.ts --out conflict-zones.md
 *
 * See `.agents/skills/upstream-sync/SKILL.md` for the full workflow.
 */

// @effect-diagnostics nodeBuiltinImport:off
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { readLastSyncBaseline } from "./fork-baseline.ts";

interface CliArgs {
  base: string | undefined;
  commits: ReadonlyArray<string> | undefined;
  out: string | undefined;
  help: boolean;
}

/**
 * High-conflict zones from FORK.md Phase 3. Keep in sync with the table in
 * docs/guides/upstream-sync.md. When a zone appears in the file intersection,
 * it is flagged as high-blast-radius.
 */
const FORK_MD_HIGH_CONFlict_ZONES: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  {
    pattern: /^packages\/contracts\//,
    label: "packages/contracts (schemas ripple to all clients)",
  },
  { pattern: /^packages\/shared\//, label: "packages/shared (shared runtime utilities)" },
  { pattern: /^apps\/server\//, label: "apps/server (providers, CLI, sessions)" },
  { pattern: /^apps\/web\//, label: "apps/web (UI, WebSocket client, session UX)" },
  {
    pattern: /^apps\/desktop\//,
    label: "apps/desktop (Electron shell, branding, backend manager)",
  },
  {
    pattern: /^scripts\/dev-runner\.ts$/,
    label: "scripts/dev-runner.ts (dev ports and orchestration)",
  },
  { pattern: /^pnpm-lock\.yaml$/, label: "pnpm-lock.yaml (regenerate with vp i after merge)" },
  {
    pattern: /^(package\.json|apps\/[^/]+\/package\.json|packages\/[^/]+\/package\.json)$/,
    label: "package.json (scripts, filters, versions)",
  },
];

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const args: CliArgs = { base: undefined, commits: undefined, out: undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") args.base = argv[++i];
    else if (arg === "--commits") {
      const raw = argv[++i];
      args.commits = raw
        .split(",")
        .map((sha) => sha.trim())
        .filter((sha) => sha.length > 0);
    } else if (arg === "--out") args.out = argv[++i];
    else if (arg === "-h" || arg === "--help") args.help = true;
  }
  return args;
}

function git(args: ReadonlyArray<string>): string {
  return execFileSync("git", args as string[], { encoding: "utf8" }).trim();
}

function changedNames(range: string): Set<string> {
  // --no-renames keeps the output a flat added/modified/deleted list, which is
  // what we want for a conflict-zone heatmap.
  const out = git(["diff", "--no-renames", "--name-only", range]);
  return new Set(out.split("\n").filter((l) => l.length > 0));
}

function pathsTouchedByCommits(commits: ReadonlyArray<string>): Set<string> {
  const paths = new Set<string>();
  for (const sha of commits) {
    const out = git(["show", "--no-renames", "--name-only", "--format=", sha]);
    for (const line of out.split("\n")) {
      if (line.length > 0) paths.add(line);
    }
  }
  return paths;
}

function zoneForPath(path: string): string | undefined {
  for (const { pattern, label } of FORK_MD_HIGH_CONFlict_ZONES) {
    if (pattern.test(path)) return label;
  }
  return undefined;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      [
        "Usage: conflict-zones.ts [--base <sha>] [--commits <sha1>,<sha2>] [--out <path>]",
        "",
        "Predicts merge conflict surface by intersecting upstream-changed paths,",
        "fork-changed paths since baseline, and the FORK.md high-conflict zones.",
        "Read-only.",
      ].join("\n") + "\n",
    );
    return;
  }

  const forkMdPath = "FORK.md";
  const base =
    args.base ?? readLastSyncBaseline(forkMdPath) ?? git(["merge-base", "main", "upstream/main"]);
  const upstreamTip = git(["rev-parse", "upstream/main"]);

  process.stderr.write(`Base: ${base}\n`);
  process.stderr.write(`Fetching upstream...\n`);
  git(["fetch", "upstream", "--tags"]);

  const upstreamPaths =
    args.commits && args.commits.length > 0
      ? pathsTouchedByCommits(args.commits)
      : changedNames(`${base}..upstream/main`);
  // main..base is empty by definition (base is an ancestor of main), so the
  // fork-side changes since baseline are base..main.
  const forkPaths = changedNames(`${base}..main`);

  const intersection = [...upstreamPaths].filter((p) => forkPaths.has(p)).sort();

  process.stderr.write(
    `Upstream touched ${upstreamPaths.size} paths; fork touched ${forkPaths.size}; intersection ${intersection.length}\n`,
  );

  const highBlast = intersection
    .map((p) => ({ path: p, zone: zoneForPath(p) }))
    .filter((r): r is { path: string; zone: string } => r.zone !== undefined);

  const lowBlast = intersection.filter((p) => !zoneForPath(p));

  const lines: string[] = [];
  lines.push(`# Predicted conflict zones`);
  lines.push("");
  lines.push(`- Base (last scan): \`${base}\``);
  lines.push(`- Upstream tip: \`${upstreamTip}\``);
  if (args.commits && args.commits.length > 0) {
    lines.push(
      `- Commit cluster: ${args.commits.map((sha) => `\`${sha.slice(0, 10)}\``).join(", ")}`,
    );
  }
  lines.push(`- Upstream-touched paths: ${upstreamPaths.size}`);
  lines.push(`- Fork-modified paths since base: ${forkPaths.size}`);
  lines.push(`- Intersection (both sides changed — will conflict): ${intersection.length}`);
  lines.push("");

  if (highBlast.length > 0) {
    // Zone-level rollup first: at scale (hundreds of files), the per-path table
    // is noise. The maintainer resolves by zone, not by file.
    const zoneCounts = new Map<string, number>();
    for (const { zone } of highBlast) {
      zoneCounts.set(zone, (zoneCounts.get(zone) ?? 0) + 1);
    }
    lines.push(`## High-conflict zones (FORK.md catalog) — zone rollup`);
    lines.push("");
    lines.push(
      "Both fork and upstream changed files in these remembered high-blast-radius areas. Budget extra resolution time per zone.",
    );
    lines.push("");
    lines.push("| Zone | Conflicting files |");
    lines.push("| --- | --- |");
    const sortedZones = [...zoneCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [zone, count] of sortedZones) {
      lines.push(`| ${zone} | ${count} |`);
    }
    lines.push("");
    lines.push(`<details><summary>Full per-path list (${highBlast.length} files)</summary>`);
    lines.push("");
    lines.push("| Path | Zone |");
    lines.push("| --- | --- |");
    for (const { path, zone } of highBlast) {
      lines.push(`| \`${path}\` | ${zone} |`);
    }
    lines.push("");
    lines.push(`</details>`);
    lines.push("");
  }

  if (lowBlast.length > 0) {
    lines.push(`## Other conflicting paths`);
    lines.push("");
    lines.push(
      "Both fork and upstream changed these, but they fall outside the FORK.md high-conflict catalog. Usually lower-effort resolutions.",
    );
    lines.push("");
    for (const p of lowBlast.slice(0, 200)) {
      lines.push(`- \`${p}\``);
    }
    if (lowBlast.length > 200) {
      lines.push(`- ...and ${lowBlast.length - 200} more`);
    }
    lines.push("");
  }

  if (intersection.length === 0) {
    lines.push(`## No intersecting changes`);
    lines.push("");
    lines.push(
      "Upstream and fork have not touched any of the same files since the baseline. A merge is expected to be clean (verify with a trial merge anyway).",
    );
    lines.push("");
  }

  lines.push(`## Next step`);
  lines.push("");
  lines.push("Open a sync branch and run a trial merge to confirm these predictions:");
  lines.push("");
  lines.push("```");
  lines.push("git checkout -b upstream-sync-$(date +%Y-%m-%d)");
  lines.push("git merge upstream/main   # expect conflicts in the high-conflict zones above");
  lines.push("```");
  lines.push("");

  const markdown = lines.join("\n");
  if (args.out) {
    writeFileSync(args.out, markdown + "\n");
    process.stdout.write(args.out + "\n");
  } else {
    process.stdout.write(markdown + "\n");
  }
}

main();
