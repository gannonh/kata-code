#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;

const staleToolchainFiles = [
  "docs/operations/ci.md",
  "docs/operations/release.md",
  "docs/reference/scripts.md",
  "docs/architecture/overview.md",
];

const staleToolchainPatterns = [
  /\bbun run\b/,
  /\bturbo watch\b/,
  /localhost:3773\b/,
  /~\/\.t3\b/,
  /\bt3:\/\/\b/,
];

const errors = [];

for (const relPath of staleToolchainFiles) {
  const filePath = join(repoRoot, relPath);
  const content = readFileSync(filePath, "utf8");
  for (const pattern of staleToolchainPatterns) {
    if (pattern.test(content)) {
      errors.push(`${relPath}: stale toolchain reference matched ${pattern}`);
    }
  }
}

const specsIndexPath = join(repoRoot, "docs/specs/index.md");
const specsIndex = readFileSync(specsIndexPath, "utf8");
if (specsIndex.includes("/specs/fork-setup.md#")) {
  errors.push(
    "docs/specs/index.md: must link phase details to FORK.md anchors, not fork-setup.md fragments",
  );
}

if (errors.length > 0) {
  process.stderr.write("OKF check failed:\n");
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`);
  }
  process.exit(1);
}

process.stdout.write("OKF check passed.\n");
