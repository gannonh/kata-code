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
  /(^|[&|;][ \t]*)[ \t]*(?:(?:if|elif|then|do|else|while|until|time|exec|!)[ \t]+)*(?:sudo[ \t]+)?(?:node|bun|deno|bash|sh|zsh|python3?|pwsh|powershell)[ \t]+/gm;
const directScriptPattern =
  /(^|[&|;][ \t]*)[ \t]*(\.\/[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.(?:sh|bash|py|ps1))/gm;
const inlineRequirePattern = /(?:require|import)\(\s*(['"])(\.\.?\/[^'"]+)\1\s*\)/g;
const workingDirectoryPattern = /^\s*working-directory:\s*(.+?)\s*$/;
const scriptBlockPattern = /^\s*script:\s*[|>][+-]?\s*$/;
const scriptInlinePattern = /^\s*script:\s*(\S.*)$/;
const inlineJavaScriptPattern = /\bnode\s+(?:-[ep]\b|--eval\b|--print\b)/;
const moduleExtensions = [".js", ".cjs", ".mjs", ".json", ".node"];
const moduleIndexFiles = moduleExtensions.map((extension) => `index${extension}`);
const scriptPathPattern =
  /^\.?\/?[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.(?:ts|tsx|mts|cts|mjs|cjs|js|sh|bash|py|ps1)$/;
const unresolvedValuePattern = /[$*?\[\]{}~'"=]/;

function isUnresolved(value) {
  return unresolvedValuePattern.test(value);
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function isFile(target) {
  return NodeFS.existsSync(target) && NodeFS.statSync(target).isFile();
}

function resolvesAsModule(target) {
  if (isFile(target)) return true;
  if (moduleExtensions.some((extension) => isFile(`${target}${extension}`))) return true;
  return moduleIndexFiles.some((name) => isFile(NodePath.join(target, name)));
}

function report(relativePath, line, message) {
  findings.push(`${relativePath}:${line}: ${message}`);
}

function collectBlocks(lines, blockPattern, inlinePattern) {
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const blockMatch = blockPattern.exec(line);
    const inlineMatch = blockMatch === null ? inlinePattern.exec(line) : null;
    if (blockMatch === null && inlineMatch === null) continue;
    if (blockMatch !== null) {
      const baseIndent = indentOf(line);
      const blockLines = [];
      let cursor = index + 1;
      for (; cursor < lines.length; cursor += 1) {
        const candidate = lines[cursor];
        if (candidate.trim() !== "" && indentOf(candidate) <= baseIndent) break;
        blockLines.push(candidate);
      }
      blocks.push({ startLine: index + 2, lines: blockLines });
      index = cursor - 1;
    } else {
      blocks.push({ startLine: index + 1, lines: [inlineMatch[1]] });
    }
  }
  return blocks;
}

function workingDirectoryBefore(lines, lineIndex) {
  for (let index = lineIndex; index >= 0; index -= 1) {
    const match = workingDirectoryPattern.exec(lines[index]);
    if (match === null) continue;
    const value = match[1]
      .replace(/\s+#.*$/, "")
      .replace(/^['"]|['"]$/g, "")
      .trim();
    if (value.includes("${{")) return { dynamic: true, value: null };
    if (value.startsWith("/") || isUnresolved(value)) return { dynamic: false, value: null };
    return { dynamic: false, value: value.replace(/^\.\//, "") };
  }
  return { dynamic: false, value: null };
}

function reportMissingInlineReferences(
  relativePath,
  lineNumber,
  text,
  workingDirectory,
  commentMarker,
) {
  inlineRequirePattern.lastIndex = 0;
  for (
    let match = inlineRequirePattern.exec(text);
    match !== null;
    match = inlineRequirePattern.exec(text)
  ) {
    const commentIndex = text.indexOf(commentMarker);
    if (commentIndex !== -1 && commentIndex < match.index) continue;
    const reference = match[2].replace(/^\.\//, "");
    const targets = [NodePath.join(root, reference)];
    if (workingDirectory !== null) {
      targets.push(NodePath.join(root, workingDirectory, reference));
    }
    if (!targets.some(resolvesAsModule)) {
      report(relativePath, lineNumber, `inline script reference does not exist: ${match[2]}`);
    }
  }
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
      const needsLine = index + 1;
      let value = needsMatch[2].replace(/#.*$/, "").trim();
      if (value === "") {
        let cursor = index + 1;
        while (cursor < lines.length && lines[cursor].trim() === "") cursor += 1;
        if (cursor < lines.length && lines[cursor].trim().startsWith("[")) {
          const parts = [];
          for (; cursor < lines.length; cursor += 1) {
            parts.push(lines[cursor].trim().replace(/#.*$/, ""));
            if (lines[cursor].includes("]")) break;
          }
          value = parts.join(" ");
          index = cursor;
        } else {
          needsIndent = indentOf(line);
        }
      }
      if (value.startsWith("[")) {
        for (const entry of value.replace(/^\[|\]$/g, "").split(",")) {
          const name = entry.trim().replace(/^['"]|['"]$/g, "");
          if (name !== "") needs.push([name, needsLine]);
        }
      } else if (value !== "" && !value.includes("${{")) {
        needs.push([value.replace(/^['"]|['"]$/g, ""), needsLine]);
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
    if (isUnresolved(value)) return;
    references.push({ reference: value, index });
  };

  interpreterPattern.lastIndex = 0;
  for (
    let match = interpreterPattern.exec(text);
    match !== null;
    match = interpreterPattern.exec(text)
  ) {
    const remainder = text.slice(match.index + match[0].length).split(/\s+/);
    const candidate = remainder.find(
      (part) => !part.startsWith("-") && !isUnresolved(part) && scriptPathPattern.test(part),
    );
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

function checkScriptBlocks(relativePath, lines) {
  for (const block of collectBlocks(lines, scriptBlockPattern, scriptInlinePattern)) {
    block.lines.forEach((line, offset) => {
      reportMissingInlineReferences(relativePath, block.startLine + offset, line, null, "//");
    });
  }
}

function checkRunScripts(relativePath, lines) {
  for (const block of collectBlocks(lines, runBlockPattern, runInlinePattern)) {
    const workingDirectory = workingDirectoryBefore(lines, block.startLine - 2);
    if (workingDirectory.dynamic) continue;
    const text = block.lines.join("\n");

    for (const { reference, index: offset } of collectScriptReferences(text)) {
      const targets = [NodePath.join(root, reference)];
      if (workingDirectory.value !== null) {
        targets.push(NodePath.join(root, workingDirectory.value, reference));
      }
      if (!targets.some(isFile)) {
        const lineOffset = text.slice(0, offset).split("\n").length - 1;
        report(
          relativePath,
          block.startLine + lineOffset,
          `run step references a missing file: ${reference}`,
        );
      }
    }

    block.lines.forEach((lineText, offset) => {
      if (!inlineJavaScriptPattern.test(lineText)) return;
      reportMissingInlineReferences(
        relativePath,
        block.startLine + offset,
        lineText,
        workingDirectory.value,
        "#",
      );
    });
  }
}

for (const file of workflowFiles) {
  const relativePath = NodePath.relative(root, NodePath.join(workflowsDirectory, file))
    .split("\\")
    .join("/");
  const lines = NodeFS.readFileSync(NodePath.join(workflowsDirectory, file), "utf8").split("\n");
  checkLocalUses(relativePath, lines);
  checkJobNeeds(relativePath, lines);
  checkScriptBlocks(relativePath, lines);
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
