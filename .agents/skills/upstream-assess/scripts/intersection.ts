#!/usr/bin/env node
// intersection.ts — for an upstream commit or range, show which files it touches
// that the fork has also modified. Used during triage to size porting risk.
//
// Part of the upstream-assess skill (ADR 0004 — selective vendor-pull).
// Read-only: runs git, writes markdown to stdout.
//
// Run from the repo root:
//   node .agents/skills/upstream-assess/scripts/intersection.ts <sha>
//   node .agents/skills/upstream-assess/scripts/intersection.ts <base>..<tip>
//
// "Fork-modified" means: changed on the current branch (main) relative to the
// upstream baseline (merge-base of main and upstream/main). This captures the
// fork's divergence surface without needing a maintained list.

import { execFileSync } from "node:child_process";

const REMOTE_REF = "upstream/main";
import { readFileSync, existsSync } from "node:fs";

// readFileSync/existsSync are imported for future FORK.md-aware baselining
// (parity with scan-upstream.ts); not yet used in this script.

function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (e: any) {
    const stderr = (e?.stderr || e?.message || "").toString().trim();
    throw new Error(`git ${args.join(" ")} failed${stderr ? ": " + stderr : ""}`, { cause: e });
  }
}

// High-divergence zones from the SKILL.md. Files in these areas are flagged
// when they appear in the intersection, since they tend to collide with fork
// changes (branding, auth, relay, dev env, deps).
const HIGH_DIVERGENCE = [
  "packages/contracts/",
  "packages/shared/",
  "apps/server/",
  "apps/web/",
  "apps/desktop/",
  "scripts/dev-runner.ts",
  "pnpm-lock.yaml",
  "package.json",
];

function isHighDivergence(path: string): boolean {
  // package.json exists at multiple levels; match either the exact path or a subdir package.json.
  if (path === "package.json") return true;
  for (const z of HIGH_DIVERGENCE) {
    if (z.endsWith("/")) {
      if (path.startsWith(z)) return true;
    } else if (path === z) {
      return true;
    }
  }
  return false;
}

function upstreamFiles(arg: string): { files: string[]; rangeLabel: string } {
  // Support "sha", "base..tip", or "^sha".
  let range: string;
  if (arg.includes("..")) {
    range = arg;
  } else if (arg.startsWith("^")) {
    range = arg;
  } else {
    // Single commit: diff that commit against its first parent.
    range = `${arg}^..${arg}`;
  }
  const files = git("diff", "--name-only", "--no-renames", range)
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  return { files, rangeLabel: range };
}

// Files the fork has changed since the upstream baseline = merge-base(main, upstream/main).
function forkModifiedFiles(): Set<string> {
  let baseline: string;
  try {
    baseline = git("merge-base", "main", REMOTE_REF);
  } catch {
    throw new Error(
      `Could not compute merge-base(main, ${REMOTE_REF}). ` +
        `Ensure both refs exist (git fetch ${REMOTE_REF.replace("/main", "")} --tags).`,
    );
  }
  const files = git("diff", "--name-only", "--no-renames", `${baseline}..main`)
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  return new Set(files);
}

function areaOf(path: string): string {
  const parts = path.split("/");
  if (parts[0] === "apps" && parts.length > 1) return `apps/${parts[1]}`;
  if (parts[0] === "packages" && parts.length > 1) return `packages/${parts[1]}`;
  if (parts[0] === ".github") return ".github";
  return parts[0] || "(root)";
}

function main(): void {
  const arg = process.argv[2];
  if (!arg || arg === "-h" || arg === "--help") {
    console.log(
      `Usage:\n` +
        `  node .agents/skills/upstream-assess/scripts/intersection.ts <sha>\n` +
        `  node .agents/skills/upstream-assess/scripts/intersection.ts <base>..<tip>\n\n` +
        `Shows which files the upstream change(s) touch that the fork has also modified.\n` +
        `High-divergence zones (contracts, shared, server/web/desktop, branding, relay)\n` +
        `are flagged. Read-only.`,
    );
    return;
  }

  // Resolve the upstream change set. We diff against upstream/main's tree state
  // so we look at what upstream actually changed, independent of the fork.
  const { files: upstreamChanged, rangeLabel } = upstreamFiles(arg);

  let forkModified: Set<string>;
  try {
    forkModified = forkModifiedFiles();
  } catch (e: any) {
    console.error(`[intersection] ${e.message}`);
    process.exit(1);
  }

  const intersected = upstreamChanged.filter((f) => forkModified.has(f));
  const highRisk = intersected.filter((f) => isHighDivergence(f));
  const clean = upstreamChanged.filter((f) => !forkModified.has(f));

  const out: string[] = [];
  out.push(`# Intersection: \`${rangeLabel}\``);
  out.push("");
  out.push(`- Upstream files touched: **${upstreamChanged.length}**`);
  out.push(`- Of those, also modified by the fork: **${intersected.length}**`);
  out.push(`- Of those, in a high-divergence zone: **${highRisk.length}**`);
  out.push(`- Upstream-only (no fork conflict expected): **${clean.length}**`);
  out.push("");

  if (highRisk.length) {
    out.push(`## High-divergence overlap (hand-merge of intent likely needed)`);
    out.push("");
    for (const f of highRisk) out.push(`- \`${f}\``);
    out.push("");
  }

  if (intersected.length > highRisk.length) {
    out.push(`## Other fork-modified overlap`);
    out.push("");
    for (const f of intersected) {
      if (!highRisk.includes(f)) out.push(`- \`${f}\``);
    }
    out.push("");
  }

  if (clean.length) {
    out.push(`## Upstream-only changes (grouped by area)`);
    out.push("");
    const byArea = new Map<string, string[]>();
    for (const f of clean) {
      const a = areaOf(f);
      if (!byArea.has(a)) byArea.set(a, []);
      byArea.get(a)!.push(f);
    }
    for (const [area, fs] of [...byArea.entries()].sort()) {
      out.push(`### ${area} (${fs.length})`);
      for (const f of fs) out.push(`- \`${f}\``);
      out.push("");
    }
  }

  if (!intersected.length) {
    out.push(`## Verdict`);
    out.push("");
    out.push(`No overlap with fork-modified files. This change is likely a clean port.`);
    out.push(``);
  }

  process.stdout.write(out.join("\n"));
}

main();
