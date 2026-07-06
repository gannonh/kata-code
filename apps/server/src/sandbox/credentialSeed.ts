/**
 * `credentialSeed` — build sanitized tar archives of the host's provider
 * credential directories for seeding into a sandbox via `copyInto`.
 *
 * Replaces the Phase 3a bind-mount approach. Bind-mounts leaked host-absolute
 * paths (codex `config.toml`'s `model_catalog_json`, project trust paths) and
 * broken symlinks (`AGENTS.md` → `/Users/.../dotfiles/...`) into the container,
 * where they don't resolve. This module copies the credential dirs host-side,
 * dereferences symlinks into real files, excludes runtime state (sqlite, logs,
 * history, sessions), sanitizes config files (strip host-only paths, pre-trust
 * `/workspace`), and ships auth files separately from static config.
 *
 * Two archives per provider:
 * - **static**: config files, skills, prompts, AGENTS.md (deref), etc.
 *   Extracted to the container home (e.g. `/home/katacode`).
 * - **credentials**: auth files only (`auth.json`, `.credentials.json`).
 *   Extracted to the same home, separately, so a failed static seed doesn't
 *   lose auth and the two can be uploaded independently.
 *
 * Provider-agnostic: the same archives feed the local Docker driver's
 * `copyInto` now and the Railway cloud driver's file upload later.
 *
 * @module credentialSeed
 */
// @effect-diagnostics nodeBuiltinImport:off - host-side tar builder uses node:fs for synchronous tree walks.
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { packUstarArchive, type UstarFile, type UstarContent } from "./ustarWriter.ts";

import { HostProcessPlatform } from "@kata-sh/code-shared/hostProcess";

/** The sandbox container's `/workspace` (pre-trusted in sanitized configs). */
const WORKSPACE = "/workspace";

/** Error raised by the credential seed builder. */
export class CredentialSeedError extends Data.TaggedError("CredentialSeedError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** A provider's static + credentials archives, ready for `copyInto`. */
export interface CredentialSeedArchives {
  /** Static config tar (config files, skills, prompts — no auth). Extract to container home. */
  readonly static: Uint8Array | null;
  /** Credentials tar (auth files only). Extract to container home. */
  readonly credentials: Uint8Array | null;
}

/** Input to `buildCredentialSeedArchives`. */
export interface CredentialSeedInput {
  /** Absolute host home directory (e.g. `/Users/foo`). */
  readonly hostHome: string;
  /** Predicate to test whether a host path exists. Defaults to `fs.existsSync`. */
  readonly hostPathExists?: (path: string) => boolean;
}

// ── Provider declarations ─────────────────────────────────────────────

/** A provider credential dir to seed. */
interface ProviderSpec {
  /** Display name for errors. */
  readonly name: string;
  /** Absolute host path to the credential dir (e.g. `~/.codex`). */
  readonly hostDir: string;
  /** Relative path inside the container home (e.g. `.codex`). */
  readonly containerRelative: string;
  /** Filenames that are credentials (ship in the credentials archive, excluded from static). */
  readonly authFiles: ReadonlyArray<string>;
  /** Glob-style excludes (matched against relative path components) for runtime state. */
  readonly excludes: ReadonlyArray<ExcludePattern>;
  /** Optional config-file sanitizer: read raw → return sanitized text. */
  readonly sanitizeConfig?: (raw: string, hostHome: string) => string | null;
  /** Config filename within the dir to sanitize (e.g. `config.toml`). */
  readonly configFileName?: string;
}

/** A glob-style exclude pattern matched against path components. */
interface ExcludePattern {
  /** The component name to exclude (e.g. `sessions`, `log`). */
  readonly name: string;
  /** When true, also exclude names prefixed with this (e.g. `state_` matches `state_1.sqlite`). */
  readonly prefix?: boolean;
}

// ── Codex (~/.codex) ──────────────────────────────────────────────────

const CODEX_EXCLUDES: ReadonlyArray<ExcludePattern> = [
  { name: "sessions" },
  { name: "log" },
  { name: "history.jsonl" },
  { name: "logs_2.sqlite" },
  { name: "logs_2.sqlite-shm" },
  { name: "logs_2.sqlite-wal" },
  { name: "goals_1.sqlite" },
  { name: "goals_1.sqlite-shm" },
  { name: "goals_1.sqlite-wal" },
  { name: "state_", prefix: true },
  { name: "session_index.jsonl" },
  { name: "external_agent_session_imports.json" },
  { name: "shell_snapshots" },
  { name: ".tmp" },
  { name: "tmp" },
  { name: ".DS_Store" },
  { name: "..codex-global-state.json.bak.tmp", prefix: true },
  { name: "..codex-global-state.json.tmp", prefix: true },
  { name: "cache" },
  { name: "ambient-suggestions" },
  { name: "automations" },
  { name: "browser" },
  { name: "computer-use" },
  { name: "generated_images" },
  { name: "memories" },
  { name: "plugins" },
  { name: "vendor_imports" },
  { name: "chrome-native-hosts-v2.json" },
  { name: "chrome-native-hosts.json" },
  { name: "herdr-agent-state.sh" },
  { name: "hooks.json.bak" },
  { name: "installation_id" },
  { name: "mcp-cache.json" },
  { name: "mcp-npx-cache.json" },
  { name: "mcp-onboarding.json" },
  { name: "sqlite" },
  { name: "memories_1.sqlite" },
  { name: "memories_1.sqlite-shm" },
  { name: "memories_1.sqlite-wal" },
  { name: "models_cache.json" },
  { name: "cursor-sdk.json" },
  { name: "cursor-sdk-context-windows.json" },
  { name: "cursor-sdk-model-list.json" },
  { name: "cursor-model-cache.json" },
];

const CLAUDE_EXCLUDES: ReadonlyArray<ExcludePattern> = [
  { name: "projects" },
  { name: "todos" },
  { name: "statsig" },
  { name: "logs" },
  { name: "plugins" },
  { name: "node_modules" },
  { name: "telemetry" },
  { name: "history.jsonl" },
  { name: "file-history" },
  { name: "shell-snapshots" },
  { name: "cache" },
  { name: "backups" },
  { name: ".disabled" },
  { name: ".DS_Store" },
];

const PI_EXCLUDES: ReadonlyArray<ExcludePattern> = [
  { name: "sessions" },
  { name: "run-history.jsonl" },
  { name: "pi-debug.log" },
  { name: "cache" },
  { name: "npm" },
  { name: "node_modules" },
  { name: "mcp-oauth" },
  { name: "bin" },
  { name: "git" },
  { name: "intercom" },
  { name: ".DS_Store" },
];

// ── Config sanitizers ─────────────────────────────────────────────────

/** Roots that are guaranteed absent in a Linux container (host-only paths). */
const HOST_ONLY_ROOTS = [
  "/Users/",
  "/home/",
  "/Applications/",
  "/opt/homebrew/",
  "/Library/",
  "/System/",
  "/private/",
];

/** True when `value` is an absolute path under a host-only root. */
function isHostOnlyPath(value: unknown, hostHome: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!value.startsWith("/")) return false; // bare names (PATH-resolved) may exist
  const roots = [...HOST_ONLY_ROOTS, hostHome.endsWith("/") ? hostHome : `${hostHome}/`];
  return roots.some((root) => value.startsWith(root));
}

/**
 * Sanitize a codex `config.toml`: parse with a minimal TOML subset, strip
 * host-only-path entries (MCP servers with host-only commands, notify
 * helpers, `model_catalog_json` pointing at a host path), and pre-trust
 * `/workspace`. Returns the sanitized text, or `null` when the input is
 * unchanged or unparseable (caller keeps the raw copy).
 *
 * This is a deliberately minimal TOML transform — not a full TOML parser. It
 * handles the `key = "value"` and `[table]` shapes codex's config uses for
 * the fields that reference host paths. A full TOML library is out of scope
 * (no dep in the repo); a parse failure leaves the raw copy intact.
 */
function sanitizeCodexConfig(raw: string, hostHome: string): string | null {
  const lines = raw.split(/\r?\n/);
  let changed = false;
  // When non-null, we are inside an mcp_servers.* table whose command line
  // has not been seen yet. Lines are buffered here and only committed once
  // we know whether the command is a host-only path.
  let pendingMcpTable: string | null = null;
  let mcpTableBuffer: string[] = [];
  // When non-null, we are dropping all lines (including subtables) of the
  // named MCP server until a table header outside that server is reached.
  let droppedMcpServer: string | null = null;
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Table header: [mcp_servers.foo] or [projects."/some/path"]
    const tableMatch = /^\[(.+)\]$/.exec(trimmed);
    if (tableMatch) {
      const table = tableMatch[1] ?? "";
      // If we are dropping an MCP server and this is a subtable of it
      // (e.g. [mcp_servers.foo.env]), keep dropping — don't push the header.
      if (droppedMcpServer !== null && table.startsWith(droppedMcpServer + ".")) {
        continue;
      }
      // Commit any pending MCP table buffer before starting a new table.
      if (pendingMcpTable !== null) {
        result.push(...mcpTableBuffer);
        mcpTableBuffer = [];
        pendingMcpTable = null;
      }
      // Any other table header ends the drop.
      droppedMcpServer = null;
      // Start buffering a new mcp_servers.* table so we can drop it entirely
      // if the command line turns out to be a host-only path.
      if (table.startsWith("mcp_servers.")) {
        pendingMcpTable = table;
        mcpTableBuffer = [line];
      } else {
        result.push(line);
      }
      continue;
    }

    // If we are dropping an MCP server table, skip all its remaining lines.
    if (droppedMcpServer !== null) {
      continue;
    }

    // Inside an mcp_servers.* table: buffer lines until we see the command.
    if (pendingMcpTable !== null) {
      mcpTableBuffer.push(line);
      const cmdMatch = /^command\s*=\s*"(.+)"$/.exec(trimmed);
      if (cmdMatch && isHostOnlyPath(cmdMatch[1], hostHome)) {
        // Command is a host-only path — drop the entire table (header + all
        // buffered lines) and skip subtables until a table outside this
        // server is reached.
        changed = true;
        droppedMcpServer = pendingMcpTable;
        mcpTableBuffer = [];
        pendingMcpTable = null;
      }
      continue;
    }

    // model_catalog_json = "/host/path" → strip the line
    const catalogMatch = /^model_catalog_json\s*=\s*"(.+)"$/.exec(trimmed);
    if (catalogMatch && isHostOnlyPath(catalogMatch[1], hostHome)) {
      changed = true;
      continue;
    }

    // notify = ["/host/path", ...] → strip the line
    const notifyMatch = /^notify\s*=\s*\[(.+)\]$/.exec(trimmed);
    if (notifyMatch) {
      const first = (notifyMatch[1] ?? "").split(",")[0]?.trim() ?? "";
      const firstValue = first.replace(/^["']/, "").replace(/["']$/, "");
      if (isHostOnlyPath(firstValue, hostHome)) {
        changed = true;
        continue;
      }
    }

    result.push(line);
  }

  // Flush any pending MCP table buffer (the last table in the file may be an
  // mcp_servers.* table that was not dropped).
  if (pendingMcpTable !== null) {
    result.push(...mcpTableBuffer);
  }

  // Pre-trust /workspace so codex doesn't prompt "trust this folder?" in the box.
  if (!raw.includes(`[projects."${WORKSPACE}"]`)) {
    result.push(``, `[projects."${WORKSPACE}"]`, `trust_level = "trusted"`);
    changed = true;
  }

  return changed ? result.join("\n") : null;
}

/** Sanitize Pi `settings.json`: strip the `packages` list so the in-container
 *  Pi SDK doesn't try to `npm install` host-installed extensions (esbuild,
 *  koffi, etc.) that have platform-specific binaries and block the provider
 *  probe past its 10s timeout. Packages are optional extensions; the core
 *  SDK auth + models work without them. Returns sanitized text or null. */
function sanitizePiSettings(raw: string, _hostHome: string): string | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!Array.isArray(parsed.packages) || parsed.packages.length === 0) return null;
    delete parsed.packages;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

/**
 * Sanitize `~/.claude.json`: add `/workspace` as a trusted project so the
 * in-box claude trusts the sandbox workspace. Returns sanitized text or
 * `null` when unchanged/unparseable.
 */
function sanitizeClaudeJson(raw: string, _hostHome: string): string | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    let changed = false;
    const projects = parsed.projects;
    if (projects && typeof projects === "object" && projects !== null) {
      const projectsMap = projects as Record<string, unknown>;
      // Add /workspace as a trusted project (claude checks projects[<cwd>]).
      if (!(WORKSPACE in projectsMap)) {
        projectsMap[WORKSPACE] = { allowedTools: {} };
        changed = true;
      }
    }
    return changed ? JSON.stringify(parsed, null, 2) : null;
  } catch {
    return null;
  }
}

// ── Provider specs ────────────────────────────────────────────────────

const PROVIDER_SPECS: ReadonlyArray<ProviderSpec> = [
  {
    name: "codex",
    hostDir: ".codex",
    containerRelative: ".codex",
    authFiles: ["auth.json"],
    excludes: CODEX_EXCLUDES,
    configFileName: "config.toml",
    sanitizeConfig: sanitizeCodexConfig,
  },
  {
    name: "claude",
    hostDir: ".claude",
    containerRelative: ".claude",
    authFiles: [".credentials.json"],
    excludes: CLAUDE_EXCLUDES,
  },
  {
    name: "pi",
    hostDir: ".pi/agent",
    containerRelative: ".pi/agent",
    authFiles: ["auth.json"],
    excludes: PI_EXCLUDES,
    configFileName: "settings.json",
    sanitizeConfig: sanitizePiSettings,
  },
];

// ── Archive builder ───────────────────────────────────────────────────

/**
 * Build the static + credentials seed archives for all providers whose host
 * dirs exist. Absent host dirs produce `null` archives (the provider starts
 * unauthenticated and surfaces its normal error). Returns the archives as
 * `Uint8Array` tars ready for `copyInto`.
 */
export function buildCredentialSeedArchives(
  input: CredentialSeedInput,
): Effect.Effect<CredentialSeedArchives, CredentialSeedError> {
  return Effect.gen(function* () {
    const exists = input.hostPathExists ?? defaultExistsSync;

    const staticFiles: UstarFile[] = [];
    const staticContents: UstarContent[] = [];
    const credentialFiles: UstarFile[] = [];

    for (const spec of PROVIDER_SPECS) {
      const hostDir = path.join(input.hostHome, spec.hostDir);
      if (!exists(hostDir)) continue;

      const collected = yield* collectProviderFiles(spec, hostDir, input.hostHome);
      staticFiles.push(...collected.staticFiles);
      staticContents.push(...collected.staticContents);
      credentialFiles.push(...collected.credentialFiles);
    }

    // Also handle ~/.claude.json (the file at home root, separate from ~/.claude/).
    const claudeJsonHost = path.join(input.hostHome, ".claude.json");
    if (exists(claudeJsonHost)) {
      const raw = yield* Effect.tryPromise({
        try: () => fs.readFile(claudeJsonHost, "utf8"),
        catch: (cause) =>
          new CredentialSeedError({
            message: `failed to read ~/.claude.json: ${String(cause)}`,
            cause,
          }),
      });
      const sanitizedText = sanitizeClaudeJson(raw, input.hostHome);
      staticContents.push({
        relativePath: ".claude.json",
        content: Buffer.from(sanitizedText ?? raw, "utf8"),
      });
    }

    // Claude on macOS stores OAuth credentials in the Keychain, not in
    // ~/.claude/.credentials.json. Extract from the Keychain and add as an
    // in-memory file to the credentials archive. On non-macOS or when the
    // Keychain entry is absent, skip (Claude falls back to ANTHROPIC_API_KEY
    // or interactive login). This mirrors AgentBox's extract pattern.
    const hasClaudeCredentials = credentialFiles.some(
      (f) => f.relativePath === ".claude/.credentials.json",
    );
    if (!hasClaudeCredentials && (yield* HostProcessPlatform) === "darwin") {
      const keychainCreds = yield* extractClaudeKeychainCredentials();
      if (keychainCreds !== null) {
        credentialFiles.push({
          relativePath: ".claude/.credentials.json",
          absolutePath: keychainCreds,
        });
      }
    }

    const staticArchive =
      staticFiles.length > 0 || staticContents.length > 0
        ? yield* Effect.tryPromise({
            try: () => packUstarArchive(staticFiles, staticContents),
            catch: (cause) =>
              new CredentialSeedError({
                message: `failed to pack static archive: ${String(cause)}`,
                cause,
              }),
          })
        : null;

    const credentialsArchive =
      credentialFiles.length > 0
        ? yield* Effect.tryPromise({
            try: () => packUstarArchive(credentialFiles),
            catch: (cause) =>
              new CredentialSeedError({
                message: `failed to pack credentials archive: ${String(cause)}`,
                cause,
              }),
          })
        : null;

    return { static: staticArchive, credentials: credentialsArchive };
  });
}

/** Default host-path-exists predicate using node:fs existsSync. */
function defaultExistsSync(p: string): boolean {
  return existsSync(p);
}

/** Parse the Claude Keychain credential blob, returning the refreshToken
 *  when present and non-empty, or null when the blob is malformed/empty. */
function parseKeychainBlob(raw: string): { claudeAiOauth?: { refreshToken?: unknown } } | null {
  try {
    const parsed = JSON.parse(raw) as { claudeAiOauth?: { refreshToken?: unknown } };
    if (
      typeof parsed.claudeAiOauth?.refreshToken !== "string" ||
      parsed.claudeAiOauth.refreshToken.length === 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Extract Claude OAuth credentials from the macOS Keychain.
 *  Claude Code on macOS stores `~/.claude/.credentials.json` content in the
 *  Keychain under `Claude Code-credentials`. This runs `security
 *  find-generic-password -s "Claude Code-credentials" -w`, writes the JSON to
 *  a temp file, and returns the path for inclusion in the credentials archive.
 *  Returns `null` on non-macOS, when the Keychain entry is absent, or when the
 *  user denies Keychain access. */
function extractClaudeKeychainCredentials(): Effect.Effect<string | null, CredentialSeedError> {
  return Effect.gen(function* () {
    if ((yield* HostProcessPlatform) !== "darwin") return null;
    const { execFile } = yield* Effect.promise(() => import("node:child_process").then((m) => m));
    const { promisify } = yield* Effect.promise(() => import("node:util").then((m) => m));
    const execFileAsync = promisify(execFile);
    // Keychain entry absent, access denied, or `security` non-zero exit —
    // log and return null so Claude falls back to ANTHROPIC_API_KEY.
    const keychainResult = yield* Effect.tryPromise(() =>
      execFileAsync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"]),
    ).pipe(
      Effect.catch((cause) =>
        Effect.logWarning(
          `[credentialSeed] Claude Keychain extraction skipped: ${cause instanceof Error ? cause.message : String(cause)}`,
        ).pipe(Effect.as(null)),
      ),
    );
    if (keychainResult === null) return null;
    const trimmed = keychainResult.stdout.trim();
    if (trimmed.length === 0) return null;
    // Validate it's a JSON object with a claudeAiOauth refresh token.
    const parsed = parseKeychainBlob(trimmed);
    if (parsed === null) {
      return null;
    }
    // Write to a temp file so the ustar writer can read it as a UstarFile.
    const { writeFile, mkdtemp } = yield* Effect.promise(() =>
      import("node:fs/promises").then((m) => m),
    );
    const { join } = yield* Effect.promise(() => import("node:path").then((m) => m));
    const { tmpdir } = yield* Effect.promise(() => import("node:os").then((m) => m));
    const dir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "kata-claude-cred-")));
    const filePath = join(dir, ".credentials.json");
    yield* Effect.promise(() => writeFile(filePath, trimmed, { mode: 0o600 }));
    return filePath;
  });
}

// ── File collection (walk + deref symlinks + exclude + sanitize) ──────

interface CollectedFiles {
  readonly staticFiles: UstarFile[];
  readonly staticContents: UstarContent[];
  readonly credentialFiles: UstarFile[];
}

/** Walk a provider dir, dereferencing symlinks, excluding runtime state and auth files. */
function collectProviderFiles(
  spec: ProviderSpec,
  hostDir: string,
  hostHome: string,
): Effect.Effect<CollectedFiles, CredentialSeedError> {
  return Effect.gen(function* () {
    const staticFiles: UstarFile[] = [];
    const staticContents: UstarContent[] = [];
    const credentialFiles: UstarFile[] = [];

    // Sanitize the config file in-memory if the provider has one.
    if (spec.configFileName && spec.sanitizeConfig) {
      const configPath = path.join(hostDir, spec.configFileName);
      const configExists = yield* pathExists(configPath);
      if (configExists) {
        const raw = yield* Effect.tryPromise({
          try: () => fs.readFile(configPath, "utf8"),
          catch: (cause) =>
            new CredentialSeedError({
              message: `failed to read ${spec.name} config: ${String(cause)}`,
              cause,
            }),
        });
        const sanitized = spec.sanitizeConfig(raw, hostHome);
        staticContents.push({
          relativePath: `${spec.containerRelative}/${spec.configFileName}`,
          content: Buffer.from(sanitized ?? raw, "utf8"),
        });
      }
    }

    // Walk the dir, collecting files (deref symlinks), excluding runtime state + auth.
    yield* walkDir(hostDir, hostDir, spec, staticFiles, credentialFiles);

    return { staticFiles, staticContents, credentialFiles };
  });
}

/** Recursively walk a directory, collecting regular files and dereferencing symlinks. */
function walkDir(
  root: string,
  currentDir: string,
  spec: ProviderSpec,
  staticFiles: UstarFile[],
  credentialFiles: UstarFile[],
): Effect.Effect<void, CredentialSeedError> {
  return Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: () => fs.readdir(currentDir, { withFileTypes: true }),
      catch: (cause) =>
        new CredentialSeedError({
          message: `failed to read dir ${currentDir}: ${String(cause)}`,
          cause,
        }),
    });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);

      // Skip excluded runtime state.
      if (isExcluded(entry.name, spec.excludes)) continue;

      // Skip the config file (already sanitized in-memory above).
      if (spec.configFileName && entry.name === spec.configFileName) continue;

      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");

      if (entry.isSymbolicLink()) {
        // Dereference: read the symlink target and copy the target file.
        const target = yield* Effect.tryPromise({
          try: () => fs.readlink(absolutePath),
          catch: (cause) =>
            new CredentialSeedError({
              message: `failed to readlink ${absolutePath}: ${String(cause)}`,
              cause,
            }),
        });
        const resolvedTarget = path.isAbsolute(target) ? target : path.resolve(currentDir, target);
        const exists = yield* pathExists(resolvedTarget);
        if (!exists) continue; // broken symlink — skip
        const targetStat = yield* Effect.tryPromise({
          try: () =>
            fs
              .stat(resolvedTarget)
              .then((stat) => stat)
              .catch(() => null),
          catch: () =>
            new CredentialSeedError({ message: `unexpected stat error for ${resolvedTarget}` }),
        });
        if (!targetStat || !targetStat.isFile()) continue; // only deref files

        const relativeArchivePath = `${spec.containerRelative}/${relativePath}`;
        if (spec.authFiles.includes(entry.name)) {
          credentialFiles.push({ relativePath: relativeArchivePath, absolutePath: resolvedTarget });
        } else {
          staticFiles.push({ relativePath: relativeArchivePath, absolutePath: resolvedTarget });
        }
      } else if (entry.isFile()) {
        const relativeArchivePath = `${spec.containerRelative}/${relativePath}`;
        if (spec.authFiles.includes(entry.name)) {
          credentialFiles.push({ relativePath: relativeArchivePath, absolutePath });
        } else {
          staticFiles.push({ relativePath: relativeArchivePath, absolutePath });
        }
      } else if (entry.isDirectory()) {
        yield* walkDir(root, absolutePath, spec, staticFiles, credentialFiles);
      }
    }
  });
}

/** Check whether a path exists (file or dir). Never fails. */
function pathExists(p: string): Effect.Effect<boolean, CredentialSeedError> {
  return Effect.tryPromise({
    try: () =>
      fs
        .access(p)
        .then(() => true)
        .catch(() => false),
    catch: () => new CredentialSeedError({ message: `unexpected error checking ${p}` }),
  });
}

/** True when `name` matches any exclude pattern. */
function isExcluded(name: string, excludes: ReadonlyArray<ExcludePattern>): boolean {
  return excludes.some((pattern) =>
    pattern.prefix ? name.startsWith(pattern.name) : name === pattern.name,
  );
}
