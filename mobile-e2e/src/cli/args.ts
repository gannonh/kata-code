export type CliMode = "run" | "list" | "studio" | "help";

export interface CliOptions {
  readonly mode: CliMode;
  /** Tags stored `@`-prefixed to match MOBILE_E2E_TAGS and credential gating. */
  readonly tags: string[];
}

function normalizeTag(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function collectTags(value: string, into: string[]): void {
  for (const part of value.split(",")) {
    const tag = normalizeTag(part);
    if (tag !== "@" && !into.includes(tag)) {
      into.push(tag);
    }
  }
}

/** Parse the `e2e:mobile` CLI argv. Pure so the parsing rules are unit-tested. */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  let mode: CliMode = "run";
  const tags: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--list") {
      mode = "list";
    } else if (arg === "--studio") {
      mode = "studio";
    } else if (arg === "--help" || arg === "-h") {
      mode = "help";
    } else if (arg === "--include-tags") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --include-tags");
      }
      collectTags(next, tags);
      i += 1;
    } else if (arg?.startsWith("--include-tags=")) {
      collectTags(arg.slice("--include-tags=".length), tags);
    }
  }

  return { mode, tags };
}
