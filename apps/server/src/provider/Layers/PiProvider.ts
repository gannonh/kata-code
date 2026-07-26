// @effect-diagnostics nodeBuiltinImport:off - Pi SDK resource loader uses Node filesystem paths; this module prepares compatible skill paths.
/**
 * PiProvider — builds a `ServerProviderDraft` snapshot for a Pi provider
 * instance by discovering auth, models, skills, and slash commands through
 * the in-process Pi SDK.
 *
 * Pi sessions run through the bundled `@earendil-works/pi-coding-agent` SDK
 * (no spawned CLI app-server). `binaryPath` is used only for an optional CLI
 * version probe; a missing binary makes version metadata unavailable but
 * never blocks SDK-backed sessions.
 *
 * `checkPiProviderStatus` accepts an injectable `discover` effect so the
 * snapshot state matrix (SDK unavailable, binary missing, no auth models,
 * authenticated models) can be exercised by unit tests without a real Pi
 * installation.
 *
 * @module provider/Layers/PiProvider
 */
import {
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  type PromptTemplate,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import type {
  ModelCapabilities,
  PiSettings,
  ProviderOptionDescriptor,
  ServerProviderModel,
  ServerProviderSkill,
  ServerProviderSlashCommand,
} from "@kata-sh/code-contracts";
import { createModelCapabilities } from "@kata-sh/code-shared/model";
import { resolveSpawnCommand } from "@kata-sh/code-shared/shell";

import { expandHomePath } from "../../pathExpansion.ts";
import {
  AUTH_PROBE_TIMEOUT_MS,
  buildServerProvider,
  parseGenericCliVersion,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PI_PRESENTATION = { displayName: "Pi" } as const;

/**
 * Canonical pi thinking levels (see `@earendil-works/pi-ai` `ThinkingLevel`).
 * `"off"` disables thinking; the rest map to provider-specific values.
 */
const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

const PI_THINKING_LEVEL_LABELS: Readonly<Record<PiThinkingLevel, string>> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

const VERSION_PROBE_TIMEOUT_MS = 4_000;
const PI_PROJECT_SKILL_DIRECTORY_NAMES = [".pi/skills", ".agents/skills", ".agent/skills"] as const;

/**
 * Structural view of a Pi SDK model. The real `Model<Api>` from
 * `@earendil-works/pi-ai` is generic over its API transport; we only need the
 * routing/identity/thinking fields here, so this narrow shape avoids leaking
 * the transport generic across the adapter boundary.
 */
export interface PiModelShape {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly reasoning: boolean;
  readonly thinkingLevelMap?: Record<string, string | null>;
}

export interface PiModelRuntimeShape {
  getAvailable(): Promise<ReadonlyArray<PiModelShape>>;
  /** Present on the real Pi SDK `ModelRuntime`; optional for test fakes. */
  registerProvider?(providerId: string, config: unknown): void;
  /** Present on the real Pi SDK `ModelRuntime`; optional for test fakes. */
  registerNativeProvider?(provider: unknown): void;
}

export type PiModelRuntimeFactory = (agentDir: string) => Promise<PiModelRuntimeShape>;

/**
 * Structural view of the extension runtime's queued provider registrations.
 * Extensions call `pi.registerProvider` during load; those calls queue here
 * until something flushes them into a `ModelRuntime` (normally `bindCore`
 * inside `AgentSession`). Kata flushes them earlier so discovery and session
 * model selection see extension-registered providers such as `cursor`.
 */
export interface PiExtensionProviderRuntime {
  readonly pendingProviderRegistrations: ReadonlyArray<{
    readonly name: string;
    readonly config: unknown;
  }>;
  readonly pendingNativeProviderRegistrations: ReadonlyArray<{
    readonly provider: unknown;
  }>;
}

/**
 * Flush extension-queued provider registrations into a `ModelRuntime`.
 * No-ops when the runtime is a test fake without register methods.
 */
export function applyPendingExtensionProviders(
  modelRuntime: PiModelRuntimeShape,
  extensionRuntime: PiExtensionProviderRuntime,
): void {
  const registerProvider = modelRuntime.registerProvider?.bind(modelRuntime);
  const registerNativeProvider = modelRuntime.registerNativeProvider?.bind(modelRuntime);
  if (!registerProvider && !registerNativeProvider) return;

  for (const { name, config } of extensionRuntime.pendingProviderRegistrations) {
    registerProvider?.(name, config);
  }
  for (const { provider } of extensionRuntime.pendingNativeProviderRegistrations) {
    registerNativeProvider?.(provider);
  }
}

export interface PiResourceDiscoveryInput {
  readonly agentDir: string;
  readonly cwd: string;
  readonly projectTrustPolicy: "never" | "always";
}

export interface PiDiscoveryInput extends PiResourceDiscoveryInput {
  readonly binaryPath: string;
  readonly customModels: ReadonlyArray<string>;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface PiDiscoveryResult {
  /** CLI version reported by `binaryPath --version`, or null when absent. */
  readonly version: string | null;
  /** Runtime-discovered, authenticated Pi models mapped to Kata entries. */
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
}

export class PiProviderDiscoveryError extends Schema.TaggedErrorClass<PiProviderDiscoveryError>()(
  "PiProviderDiscoveryError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

/**
 * Pi model slugs are provider-qualified (`provider/model`) so the model
 * picker can disambiguate models that share an id across providers.
 */
export function piModelSlug(model: Pick<PiModelShape, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

/**
 * Resolve a model selection slug against runtime-discovered models.
 *
 * - No slug → first available model
 * - Slug with `/` after the first character → match `piModelSlug(model)`
 * - Otherwise → match `model.id` (slashless id) only when exactly one model
 *   has that id; duplicate ids across providers require a qualified slug
 */
export function resolvePiModelSelection(
  modelSlug: string | undefined,
  availableModels: ReadonlyArray<PiModelShape>,
): PiModelShape | undefined {
  const slug = modelSlug?.trim();
  if (!slug) return availableModels[0];
  const slash = slug.indexOf("/");
  if (slash > 0) return availableModels.find((model) => piModelSlug(model) === slug);
  const idMatches = availableModels.filter((model) => model.id === slug);
  if (idMatches.length === 1) return idMatches[0];
  return undefined;
}

/**
 * A thinking level is supported when the model's `thinkingLevelMap` does not
 * explicitly disable it. Missing keys fall back to the provider default
 * (supported); an explicit `null` marks the level unsupported. `"off"` is
 * always available — it simply disables thinking.
 */
function isThinkingLevelSupported(
  model: Pick<PiModelShape, "reasoning" | "thinkingLevelMap">,
  level: PiThinkingLevel,
): boolean {
  if (level === "off") return true;
  if (!model.reasoning) return false;
  const map = model.thinkingLevelMap;
  if (!map) return true;
  const mapped = map[level];
  return mapped === undefined ? true : mapped !== null;
}

/**
 * Build a model's `ModelCapabilities` with a single `thinkingLevel` select
 * descriptor containing exactly the SDK-supported thinking levels for that
 * model. See acceptance criterion 4.
 */
export function piModelCapabilities(
  model: Pick<PiModelShape, "reasoning" | "thinkingLevelMap">,
): ModelCapabilities {
  const supported = PI_THINKING_LEVELS.filter((level) => isThinkingLevelSupported(model, level));
  if (supported.length <= 1) {
    return createModelCapabilities({ optionDescriptors: [] });
  }
  const descriptor: ProviderOptionDescriptor = {
    id: "thinkingLevel",
    label: "Thinking",
    type: "select",
    options: supported.map((level) =>
      level === "off"
        ? { id: level, label: PI_THINKING_LEVEL_LABELS[level], isDefault: true }
        : { id: level, label: PI_THINKING_LEVEL_LABELS[level] },
    ),
    currentValue: "off",
  };
  return createModelCapabilities({ optionDescriptors: [descriptor] });
}

/**
 * Resolve the Pi SDK `thinkingLevel` for session creation. Reasoning models
 * default to `"off"` when the user has not chosen a level so provider-specific
 * defaults (e.g. Hyper GLM-5.2 → `"max"`) do not stream only reasoning deltas
 * that Kata does not project into assistant messages.
 */
export function resolvePiThinkingLevelForSession(
  model: Pick<PiModelShape, "reasoning" | "thinkingLevelMap"> | undefined,
  modelSelection: { options?: ReadonlyArray<{ id: string; value: string | boolean }> } | undefined,
): PiThinkingLevel | undefined {
  if (!model) {
    return undefined;
  }

  const selection = modelSelection?.options?.find((option) => option.id === "thinkingLevel");
  const requested = typeof selection?.value === "string" ? selection.value.trim() : undefined;
  if (requested) {
    const level = requested as PiThinkingLevel;
    if (PI_THINKING_LEVELS.includes(level) && isThinkingLevelSupported(model, level)) {
      return level;
    }
  }

  if (model.reasoning && isThinkingLevelSupported(model, "off")) {
    return "off";
  }

  return undefined;
}

/**
 * Map Pi SDK models into Kata `ServerProviderModel` entries. Only
 * authenticated models (registry `getAvailable`) are passed in by the
 * discovery layer, so the picker never offers a model the user cannot run.
 */
export function mapPiModels(
  models: ReadonlyArray<PiModelShape>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  const discovered: ServerProviderModel[] = models.map((model) => ({
    slug: piModelSlug(model),
    name: model.name,
    subProvider: model.provider,
    isCustom: false,
    capabilities: piModelCapabilities(model),
  }));

  const seen = new Set(discovered.map((model) => model.slug));
  const customEntries: ServerProviderModel[] = [];
  for (const candidate of customModels) {
    const slug = candidate.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    customEntries.push({ slug, name: slug, isCustom: true, capabilities: null });
  }
  return [...discovered, ...customEntries];
}

export function mapPiSkills(skills: ReadonlyArray<Skill>): ReadonlyArray<ServerProviderSkill> {
  return skills.map((skill) => ({
    name: skill.name,
    path: skill.filePath,
    enabled: !skill.disableModelInvocation,
    ...(skill.sourceInfo?.scope ? { scope: skill.sourceInfo.scope } : {}),
    ...(skill.description ? { description: skill.description } : {}),
  }));
}

export function mapPiSlashCommands(
  prompts: ReadonlyArray<PromptTemplate>,
): ReadonlyArray<ServerProviderSlashCommand> {
  return prompts.map((prompt) => {
    const name = prompt.name.replace(/^\//, "");
    const hint = prompt.argumentHint?.trim();
    return {
      name,
      input: { hint: hint || "Message" },
      ...(prompt.description ? { description: prompt.description } : {}),
    };
  });
}

/** Resolve the effective agent directory, expanding `~` and falling back to the SDK default. */
export function resolvePiAgentDir(agentDir: string): string {
  const trimmed = agentDir.trim();
  return trimmed.length > 0 ? expandHomePath(trimmed) : getAgentDir();
}

export const createPiModelRuntime: PiModelRuntimeFactory = async (agentDir) => {
  const resolvedAgentDir = resolvePiAgentDir(agentDir);
  return ModelRuntime.create({
    authPath: `${resolvedAgentDir}/auth.json`,
    modelsPath: `${resolvedAgentDir}/models.json`,
  });
};

export function resolvePiProjectSkillPaths(cwd: string): ReadonlyArray<string> {
  const resolvedCwd = NodePath.resolve(cwd);
  return PI_PROJECT_SKILL_DIRECTORY_NAMES.map((directoryName) =>
    NodePath.join(resolvedCwd, directoryName),
  ).filter((candidate) => NodeFs.existsSync(candidate));
}

const probePiVersion = (
  binaryPath: string,
  environment: NodeJS.ProcessEnv,
): Effect.Effect<string | null, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const command = binaryPath || "pi";
    const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], {
      env: environment,
    });
    const result = yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    ).pipe(Effect.timeoutOption(Duration.millis(VERSION_PROBE_TIMEOUT_MS)));
    if (Option.isNone(result)) return null;
    return parseGenericCliVersion(`${result.value.stdout}\n${result.value.stderr}`);
  }).pipe(Effect.catchCause(() => Effect.succeed<string | null>(null)));

/**
 * Discover the skills and prompt commands shown in Kata's Pi provider UI.
 * Skills/prompt discovery keeps extensions off so a blocking extension cannot
 * stall skill enumeration. Extension-registered *models* are loaded separately
 * via {@link loadPiExtensionProvidersIntoRuntime}. Project skill paths and the
 * trust policy still apply so discovery matches the real agent cwd.
 */
export const discoverPiResources = Effect.fn("discoverPiResources")(function* (
  input: PiResourceDiscoveryInput,
): Effect.fn.Return<Pick<PiDiscoveryResult, "skills" | "slashCommands">, never, never> {
  const raw = yield* Effect.promise(async () => {
    const loader = new DefaultResourceLoader({
      cwd: input.cwd,
      agentDir: input.agentDir || getAgentDir(),
      additionalSkillPaths: [...resolvePiProjectSkillPaths(input.cwd)],
      noExtensions: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload({
      resolveProjectTrust: () => Promise.resolve(input.projectTrustPolicy === "always"),
    });

    return {
      skills: loader.getSkills().skills,
      prompts: loader.getPrompts().prompts,
    };
  });

  return {
    skills: mapPiSkills(raw.skills as ReadonlyArray<Skill>),
    slashCommands: mapPiSlashCommands(raw.prompts as ReadonlyArray<PromptTemplate>),
  };
});

/**
 * Load Pi extensions and flush their `registerProvider` calls into `modelRuntime`
 * so extension-registered providers (e.g. `cursor` from `pi-cursor-sdk`) appear
 * in `getAvailable()`. Themes/context/skills are skipped; only extension modules
 * run. Bounded by the caller (provider status probe timeout).
 */
export async function loadPiExtensionProvidersIntoRuntime(
  modelRuntime: PiModelRuntimeShape,
  input: PiResourceDiscoveryInput,
): Promise<void> {
  const loader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.agentDir || getAgentDir(),
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload({
    resolveProjectTrust: () => Promise.resolve(input.projectTrustPolicy === "always"),
  });
  applyPendingExtensionProviders(
    modelRuntime,
    loader.getExtensions().runtime as PiExtensionProviderRuntime,
  );
}

/**
 * Real SDK discovery: CLI version probe + extension-aware
 * `ModelRuntime.getAvailable()` for authenticated models + bounded resource
 * discovery for skills and prompt commands. Returns the mapped
 * `PiDiscoveryResult`. Tests inject a fake `discover` into
 * `checkPiProviderStatus` instead.
 */
export const discoverPiProvider = Effect.fn("discoverPiProvider")(function* (
  input: PiDiscoveryInput,
): Effect.fn.Return<PiDiscoveryResult, never, ChildProcessSpawner.ChildProcessSpawner> {
  const environment = input.environment ?? process.env;
  const version = yield* probePiVersion(input.binaryPath, environment);
  const modelRuntime = yield* Effect.promise(() => createPiModelRuntime(input.agentDir));
  // Extension providers (cursor, oauth helpers, …) only exist after their
  // modules run and registrations are flushed into the runtime. Without this
  // step the picker only shows built-in / models.json entries.
  const models = yield* Effect.promise(async () => {
    await loadPiExtensionProvidersIntoRuntime(modelRuntime, input);
    return modelRuntime.getAvailable();
  });
  const resources = yield* discoverPiResources(input);

  return {
    version,
    models: mapPiModels(models as ReadonlyArray<PiModelShape>, input.customModels),
    ...resources,
  };
});

const emptyPiModelsFromSettings = (piSettings: PiSettings): ReadonlyArray<ServerProviderModel> => {
  // Mirror mapPiModels' trim/dedupe so pending/error/disabled snapshots don't
  // surface blank or duplicate custom entries that disappear once discovery
  // succeeds.
  const seen = new Set<string>();
  const entries: ServerProviderModel[] = [];
  for (const candidate of piSettings.customModels) {
    const slug = candidate.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    entries.push({ slug, name: slug, isCustom: true, capabilities: null });
  }
  return entries;
};

export const makePendingPiProvider = (piSettings: PiSettings): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const models = emptyPiModelsFromSettings(piSettings);

    if (!piSettings.enabled) {
      return buildServerProvider({
        presentation: PI_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Pi is disabled in Kata Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Pi provider status has not been checked in this session yet.",
      },
    });
  });

/**
 * Build a Pi provider snapshot. The `discover` parameter defaults to the real
 * SDK discovery and is injectable so the four criterion-3 states can be
 * asserted in tests.
 */
export const checkPiProviderStatus = Effect.fn("checkPiProviderStatus")(function* (
  piSettings: PiSettings,
  discover: (
    input: PiDiscoveryInput,
  ) => Effect.Effect<
    PiDiscoveryResult,
    PiProviderDiscoveryError,
    ChildProcessSpawner.ChildProcessSpawner
  > = discoverPiProvider,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = emptyPiModelsFromSettings(piSettings);

  if (!piSettings.enabled) {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: false,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Pi is disabled in Kata Code settings.",
      },
    });
  }

  const agentDir = resolvePiAgentDir(piSettings.agentDir);
  const discovery = yield* discover({
    agentDir,
    binaryPath: piSettings.binaryPath,
    customModels: piSettings.customModels,
    cwd: process.cwd(),
    projectTrustPolicy: piSettings.projectTrustPolicy,
    environment,
  }).pipe(Effect.timeoutOption(Duration.millis(AUTH_PROBE_TIMEOUT_MS)), Effect.result);

  if (Result.isFailure(discovery)) {
    const error = discovery.failure;
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: piSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: `Pi SDK provider probe failed: ${
          error instanceof Error ? error.message : String(error)
        }.`,
      },
    });
  }

  if (Option.isNone(discovery.success)) {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: piSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Timed out while checking the Pi provider status.",
      },
    });
  }

  const result = discovery.success.value;
  const hasAuthenticatedModels = result.models.some((model) => !model.isCustom);

  return buildServerProvider({
    presentation: PI_PRESENTATION,
    enabled: piSettings.enabled,
    checkedAt,
    models: result.models,
    skills: result.skills,
    slashCommands: result.slashCommands,
    probe: {
      installed: true,
      version: result.version,
      status: hasAuthenticatedModels ? "ready" : "error",
      auth: hasAuthenticatedModels ? { status: "authenticated" } : { status: "unauthenticated" },
      ...(hasAuthenticatedModels
        ? {}
        : {
            message:
              "Pi has no authenticated models. Configure Pi auth or an API key and try again.",
          }),
    },
  });
});
