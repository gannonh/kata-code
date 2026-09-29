#!/usr/bin/env node
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const repositoryRoot = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const root = NodePath.resolve(process.argv[2] ?? repositoryRoot);
const exceptions = JSON.parse(
  NodeFS.readFileSync(new URL("../docs/branding-exceptions.json", import.meta.url), "utf8"),
);
const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".rs",
  ".c",
  ".h",
  ".swift",
  ".kt",
  ".kts",
  ".qml",
  ".html",
  ".css",
  ".json",
  ".xml",
  ".plist",
  ".strings",
  ".yaml",
  ".yml",
]);
const excludedDirectories = new Set([
  "node_modules",
  "dist",
  "dist-electron",
  "build",
  "target",
  ".expo",
  ".vite-plus",
  "Pods",
  ".gradle",
  "test",
  "tests",
  "__tests__",
  "__fixtures__",
  "fixtures",
]);
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
    if (/(?:^|\.)(?:test|spec)\./.test(entry.name) || /(?:^|-)lock\.json$/.test(entry.name))
      continue;
    const path = NodePath.relative(root, file).split("\\").join("/");
    const contents = NodeFS.readFileSync(file, "utf8");
    for (const match of contents.matchAll(
      /\bT3\s+(?:Code|Connect|Server|account|threads?|environment|backend|runtime|preview|needs|with)\b/gi,
    )) {
      const line = contents.slice(0, match.index).split("\n").length;
      const sourceLine = contents.split("\n")[line - 1].trim();
      if (
        exceptions.some((exception) => exception.path === path && exception.line === sourceLine)
      ) {
        continue;
      }
      findings.push({ path, line, match: match[0] });
    }
  }
}

for (const directory of [
  "apps/web",
  "apps/desktop",
  "apps/mobile",
  "apps/server",
  "packages",
  "native",
]) {
  scan(NodePath.join(root, directory));
}
for (const finding of findings) {
  console.error(
    `${finding.path}:${finding.line}: upstream product copy ${JSON.stringify(finding.match)}`,
  );
}
if (findings.length > 0) {
  console.error("Use Kata branding. See docs/product-branding.md for scope and exceptions.");
  process.exitCode = 1;
} else {
  console.log("Product branding check passed.");
}
