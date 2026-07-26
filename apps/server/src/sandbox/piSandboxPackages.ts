/**
 * `piSandboxPackages` — resolve the Pi extension packages a sandbox should
 * install, and build the in-sandbox install command.
 *
 * Pi extensions register providers at runtime. `pi-anthropic-oauth`, for
 * example, calls `pi.registerProvider("anthropic", { oauth, streamSimple })`;
 * without it an Anthropic OAuth token drives the raw `anthropic-messages` API
 * with no Claude Code header shaping, and the turn settles with no assistant
 * output. Seeding `~/.pi/agent/auth.json` alone is therefore not enough — the
 * declared packages must exist in the sandbox too.
 *
 * Host `~/.pi/agent/npm/node_modules` is never copied: it holds darwin-native
 * binaries (esbuild, koffi) that cannot run in a Linux microVM. Instead the
 * `packages` list travels in the seeded `settings.json` and the packages are
 * installed inside the sandbox from npm.
 *
 * @module piSandboxPackages
 */
// @effect-diagnostics nodeBuiltinImport:off - host-side settings read mirrors credentialSeed's host file walk.
// @effect-diagnostics preferSchemaOverJson:off - tolerant read of a foreign config file; a parse failure must degrade to "no packages", not fail provisioning.
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import * as Effect from "effect/Effect";

/** Registry prefix for package specs that resolve inside the sandbox. */
const NPM_SPEC_PREFIX = "npm:";

/**
 * Keep only registry-resolvable (`npm:`) package specs.
 *
 * Local specs (`file:/Users/...`, bare paths) point at host trees that do not
 * exist in the sandbox; leaving them in `settings.json` makes the in-container
 * Pi SDK fail to resolve them at startup.
 */
export function filterSandboxInstallablePiPackages(
  packages: ReadonlyArray<unknown>,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of packages) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed.startsWith(NPM_SPEC_PREFIX)) continue;
    if (trimmed.length === NPM_SPEC_PREFIX.length) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/**
 * Read the installable package specs declared in a host Pi `settings.json`.
 * Returns an empty list when the file is absent, unreadable, unparseable, or
 * declares no packages — a sandbox without extensions still starts.
 */
export function readPiPackagesFromSettings(raw: string): ReadonlyArray<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const packages = (parsed as Record<string, unknown>).packages;
  if (!Array.isArray(packages)) return [];
  return filterSandboxInstallablePiPackages(packages);
}

/** One package spec paired with the command that installs it. */
export interface PiPackageInstallCommand {
  readonly spec: string;
  readonly command: string;
}

/**
 * Build one install command per package spec.
 *
 * `pi install` accepts a single source per invocation — a second positional
 * argument is rejected as `Unexpected argument` and the whole command exits
 * non-zero — so specs cannot be batched. Running them separately also keeps a
 * failure attributable to the package that caused it.
 *
 * `HOME` points at the sandbox home so `pi` installs into the same agent dir
 * the credential seed wrote. `--no-approve` keeps the non-interactive install
 * from stalling on a project-trust prompt.
 */
export function buildPiPackageInstallCommands(input: {
  readonly packages: ReadonlyArray<string>;
  readonly home: string;
}): ReadonlyArray<PiPackageInstallCommand> {
  const home = shellSingleQuote(input.home);
  return filterSandboxInstallablePiPackages(input.packages).map((spec) => ({
    spec,
    command: `HOME=${home} pi install ${shellSingleQuote(spec)} --no-approve`,
  }));
}

/**
 * Read the installable Pi package specs declared on the host.
 *
 * Never fails: an absent or unreadable `~/.pi/agent/settings.json` means the
 * sandbox installs no extensions, which is a valid configuration.
 */
export function resolveHostPiPackages(): Effect.Effect<ReadonlyArray<string>> {
  const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
  return Effect.tryPromise(() => fs.readFile(settingsPath, "utf8")).pipe(
    Effect.map(readPiPackagesFromSettings),
    Effect.catch(() => Effect.succeed<ReadonlyArray<string>>([])),
  );
}

/** Escape a value for single-quote wrapping in a shell command. */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
