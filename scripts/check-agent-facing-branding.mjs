#!/usr/bin/env node
// Agent-facing MCP copy is read by models and echoed to users, so a standalone
// upstream product name there is a finding (KAT-3540). The match is
// case-sensitive so lowercase identifiers such as the `t3-code` server name and
// `t3.chat` URLs pass. See docs/product-branding.md.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const repositoryRoot = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const root = NodePath.resolve(process.argv[2] ?? repositoryRoot);
const scannedDirectory = "apps/server/src/mcp";
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const excludedFile = /(?:^|\.)(?:test|spec)\./;
const excludedDirectories = new Set(["node_modules", "__tests__", "__fixtures__", "fixtures"]);
const findings = [];

function scan(directory) {
  if (!NodeFS.existsSync(directory)) return;
  for (const entry of NodeFS.readdirSync(directory, { withFileTypes: true })) {
    const file = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) scan(file);
      continue;
    }
    if (!entry.isFile() || !sourceExtensions.has(NodePath.extname(entry.name))) continue;
    if (excludedFile.test(entry.name)) continue;
    const path = NodePath.relative(root, file).split("\\").join("/");
    const lines = NodeFS.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (/\bT3\b/.test(line)) findings.push({ path, line: index + 1 });
    });
  }
}

scan(NodePath.join(root, scannedDirectory));
for (const finding of findings) {
  console.error(`${finding.path}:${finding.line}: standalone "T3" in agent-facing MCP copy`);
}
if (findings.length > 0) {
  console.error("Use Kata Code. See docs/product-branding.md for scope.");
  process.exitCode = 1;
} else {
  console.log("Agent-facing branding check passed.");
}
