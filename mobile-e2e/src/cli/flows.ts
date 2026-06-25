import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveMobileE2eRoot } from "../harness/artifacts.ts";

export interface DiscoveredFlow {
  readonly relativePath: string;
  readonly tags: string[];
}

/**
 * Extract `@`-prefixed tags from a Maestro flow's YAML header. Reads the list
 * items under a `tags:` key and stops at the next key or the `---` separator.
 * Pure so the parsing is unit-tested.
 */
export function parseFlowTags(yamlText: string): string[] {
  const lines = yamlText.split("\n");
  const tags: string[] = [];
  let inTagsBlock = false;

  for (const line of lines) {
    if (line.trim() === "---") {
      break;
    }
    if (!inTagsBlock) {
      if (/^tags:\s*$/.test(line)) {
        inTagsBlock = true;
      }
      continue;
    }
    // Skip blank lines and comments inside the tags block so a stray empty line
    // or `#` note doesn't truncate discovery of later tags.
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const item = line.match(/^\s*-\s*(.+?)\s*$/);
    if (item?.[1]) {
      tags.push(item[1].startsWith("@") ? item[1] : `@${item[1]}`);
    } else {
      break;
    }
  }
  return tags;
}

function maestroDir(): string {
  return join(resolveMobileE2eRoot(), "maestro");
}

/**
 * Directories under `maestro/` that hold reusable `runFlow` subflows rather than
 * runnable top-level flows. They are composed by tagged flows via `runFlow` and
 * must not be discovered as standalone flows (they have no `launchApp`/tags).
 */
const SUBFLOW_DIRS = new Set(["shared"]);

function walkYaml(dir: string, base: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (base === "" && SUBFLOW_DIRS.has(entry.name)) {
        continue;
      }
      found.push(...walkYaml(abs, rel));
    } else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) {
      found.push(rel);
    }
  }
  return found;
}

export function discoverFlows(): DiscoveredFlow[] {
  const root = maestroDir();
  return walkYaml(root, "")
    .sort()
    .map((relativePath) => ({
      relativePath,
      tags: parseFlowTags(readFileSync(join(root, relativePath), "utf8")),
    }));
}
