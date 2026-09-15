#!/usr/bin/env node
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const repositoryRoot = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const root = NodePath.resolve(process.argv[2] ?? repositoryRoot);
const findings = [];

const workflowsDirectory = NodePath.join(root, ".github", "workflows");
const workflowFiles = NodeFS.existsSync(workflowsDirectory)
  ? NodeFS.readdirSync(workflowsDirectory)
      .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
      .sort()
  : [];

const localUsePattern = /^\s*(?:-\s+)?uses:\s*(['"]?)(\.\/[^'"\s#]+)\1/;
const workflowFilePattern = /\.ya?ml$/;
const jobPattern = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/;
const needsPattern = /^(\s+)needs:\s*(.*)$/;
const needsItemPattern = /^(\s+)-\s*(['"]?)([A-Za-z0-9_.-]+)\2\s*$/;
const runBlockPattern = /^\s*(?:-\s+)?run:\s*[|>][+-]?\s*$/;
const runInlinePattern = /^\s*(?:-\s+)?run:\s*(\S.*)$/;
const interpreterPattern =
  /(^|[&|;][ \t]*)[ \t]*(?:sudo[ \t]+)?(?:node|bun|deno|bash|sh|zsh|python3?|pwsh|powershell)[ \t]+/gm;
const directScriptPattern =
  /(^|[&|;][ \t]*)[ \t]*(\.\/[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.(?:sh|bash|py|ps1))/gm;
const scriptPathPattern =
  /^\.?\/?[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.(?:ts|tsx|mts|cts|mjs|cjs|js|sh|bash|py|ps1)$/;

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function report(relativePath, line, message) {
  findings.push(`${relativePath}:${line}: ${message}`);
}

function checkLocalUses(relativePath, lines) {
  lines.forEach((line, index) => {
    const match = localUsePattern.exec(line);
    if (match === null) return;
    const reference = match[2].replace(/\/+$/, "");
    const target = NodePath.join(root, reference);
    if (workflowFilePattern.test(reference)) {
      if (!reference.includes("/.github/workflows/")) {
        report(
          relativePath,
          index + 1,
          `local workflow reference must live under .github/workflows: ${reference}`,
        );
        return;
      }
      if (!NodeFS.existsSync(target) || !NodeFS.statSync(target).isFile()) {
        report(relativePath, index + 1, `local workflow reference does not exist: ${reference}`);
      }
      return;
    }
    const actionFile = ["action.yml", "action.yaml"].find((name) =>
      NodeFS.existsSync(NodePath.join(target, name)),
    );
    if (actionFile === undefined) {
      report(relativePath, index + 1, `local action reference does not exist: ${reference}`);
    }
  });
}

function checkJobNeeds(relativePath, lines) {
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsIndex === -1) return;

  const jobs = new Set();
  const needs = [];
  let currentJob = null;
  let needsIndent = null;

  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() !== "" && indentOf(line) === 0) break;

    const jobMatch = jobPattern.exec(line);
    if (jobMatch !== null) {
      currentJob = jobMatch[1];
      jobs.add(currentJob);
      needsIndent = null;
      continue;
    }
    if (currentJob === null) continue;

    const needsMatch = needsPattern.exec(line);
    if (needsMatch !== null) {
      needsIndent = null;
      if (indentOf(line) !== 4) continue;
      const value = needsMatch[2].replace(/#.*$/, "").trim();
      if (value === "") {
        needsIndent = indentOf(line);
      } else if (value.startsWith("[")) {
        for (const entry of value.replace(/^\[|\]$/g, "").split(",")) {
          const name = entry.trim().replace(/^['"]|['"]$/g, "");
          if (name !== "") needs.push([name, index + 1]);
        }
      } else if (!value.includes("${{")) {
        needs.push([value.replace(/^['"]|['"]$/g, ""), index + 1]);
      }
      continue;
    }

    if (needsIndent !== null) {
      const itemMatch = needsItemPattern.exec(line);
      if (itemMatch !== null && indentOf(line) > needsIndent) {
        needs.push([itemMatch[3], index + 1]);
        continue;
      }
      needsIndent = null;
    }
  }

  for (const [name, line] of needs) {
    if (!jobs.has(name)) {
      report(relativePath, line, `job needs an undefined job: ${name}`);
    }
  }
}

function collectScriptReferences(text) {
  const references = [];
  const add = (candidate, index) => {
    const value = candidate.replace(/^\.\//, "");
    if (!scriptPathPattern.test(value)) return;
    if (/[$*?\[\]{}~'"=]/.test(value)) return;
    references.push({ reference: value, index });
  };

  interpreterPattern.lastIndex = 0;
  for (
    let match = interpreterPattern.exec(text);
    match !== null;
    match = interpreterPattern.exec(text)
  ) {
    const remainder = text.slice(match.index + match[0].length).split(/\s+/);
    const candidate = remainder.find((part) => part !== "" && !part.startsWith("-"));
    if (candidate !== undefined) add(candidate, match.index);
  }

  directScriptPattern.lastIndex = 0;
  for (
    let match = directScriptPattern.exec(text);
    match !== null;
    match = directScriptPattern.exec(text)
  ) {
    add(match[2], match.index);
  }

  return references;
}

function checkRunScripts(relativePath, lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const blockMatch = runBlockPattern.exec(line);
    const inlineMatch = blockMatch === null ? runInlinePattern.exec(line) : null;
    if (blockMatch === null && inlineMatch === null) continue;

    let text;
    let startLine = index + 1;
    if (blockMatch !== null) {
      startLine = index + 2;
      const baseIndent = indentOf(line);
      const blockLines = [];
      let cursor = index + 1;
      for (; cursor < lines.length; cursor += 1) {
        const candidate = lines[cursor];
        if (candidate.trim() !== "" && indentOf(candidate) <= baseIndent) break;
        blockLines.push(candidate);
      }
      text = blockLines.join("\n");
      index = cursor - 1;
    } else {
      text = inlineMatch[1];
    }

    for (const { reference, index: offset } of collectScriptReferences(text)) {
      const target = NodePath.join(root, reference);
      if (!NodeFS.existsSync(target) || !NodeFS.statSync(target).isFile()) {
        const lineOffset = text.slice(0, offset).split("\n").length - 1;
        report(
          relativePath,
          startLine + lineOffset,
          `run step references a missing file: ${reference}`,
        );
      }
    }
  }
}

for (const file of workflowFiles) {
  const relativePath = NodePath.relative(root, NodePath.join(workflowsDirectory, file))
    .split("\\")
    .join("/");
  const lines = NodeFS.readFileSync(NodePath.join(workflowsDirectory, file), "utf8").split("\n");
  checkLocalUses(relativePath, lines);
  checkJobNeeds(relativePath, lines);
  checkRunScripts(relativePath, lines);
}

const uniqueFindings = [...new Set(findings)];
for (const finding of uniqueFindings) {
  console.error(finding);
}
if (uniqueFindings.length > 0) {
  console.error(
    "Resolve local workflow, action, needs, and run-step references. Parked files do not run.",
  );
  process.exitCode = 1;
} else {
  console.log(`Workflow reference check passed (${workflowFiles.length} workflows).`);
}
