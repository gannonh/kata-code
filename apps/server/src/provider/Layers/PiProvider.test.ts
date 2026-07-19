import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
// @effect-diagnostics nodeBuiltinImport:off - Tests create temporary Pi skill directories.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { PiSettings, type ServerProviderModel } from "@kata-sh/code-contracts";

import {
  checkPiProviderStatus,
  discoverPiResources,
  PiProviderDiscoveryError,
  makePendingPiProvider,
  mapPiModels,
  mapPiSlashCommands,
  mapPiSkills,
  piModelCapabilities,
  piModelSlug,
  resolvePiModelSelection,
  resolvePiProjectSkillPaths,
  resolvePiThinkingLevelForSession,
  type PiModelShape,
} from "./PiProvider.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);
const enabledSettings = decodePiSettings({});

const sampleModel = (): PiModelShape => ({
  id: "claude-opus-4-6",
  name: "Claude Opus 4.6",
  provider: "anthropic",
  reasoning: true,
  thinkingLevelMap: { xhigh: "max" },
});

it.effect("includes the GPT-5.6 Sol migration target in the Pi catalog", () =>
  Effect.promise(async () => {
    const runtime = await ModelRuntime.create({ allowModelNetwork: false });
    expect(runtime.getModel("openai-codex", "gpt-5.6-sol")).toMatchObject({
      provider: "openai-codex",
      id: "gpt-5.6-sol",
      reasoning: true,
    });
  }),
);

describe("resolvePiModelSelection", () => {
  const anthropic = sampleModel();
  const openai: PiModelShape = {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    provider: "openai-codex",
    reasoning: true,
  };
  const models = [anthropic, openai];

  it("defaults to the first model when no slug is provided", () => {
    expect(resolvePiModelSelection(undefined, models)).toBe(anthropic);
    expect(resolvePiModelSelection("", models)).toBe(anthropic);
  });

  it("matches slashless model ids", () => {
    expect(resolvePiModelSelection("gpt-5.6-sol", models)).toBe(openai);
  });

  it("matches provider-qualified slugs", () => {
    expect(resolvePiModelSelection("openai-codex/gpt-5.6-sol", models)).toBe(openai);
    expect(resolvePiModelSelection("anthropic/claude-opus-4-6", models)).toBe(anthropic);
  });

  it("returns undefined for unknown slugs", () => {
    expect(resolvePiModelSelection("missing-model", models)).toBeUndefined();
    expect(resolvePiModelSelection("other/gpt-5.6-sol", models)).toBeUndefined();
  });
});

describe("PiProvider mappers", () => {
  it("qualifies pi model slugs as provider/model", () => {
    expect(piModelSlug({ provider: "anthropic", id: "claude-opus-4-6" })).toBe(
      "anthropic/claude-opus-4-6",
    );
  });

  it("maps discovered models with provider-qualified slugs and appends custom models", () => {
    const models = mapPiModels([sampleModel()], ["custom/local-model"]);
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      slug: "anthropic/claude-opus-4-6",
      name: "Claude Opus 4.6",
      subProvider: "anthropic",
      isCustom: false,
    });
    expect(models[1]).toMatchObject({ slug: "custom/local-model", isCustom: true });
  });

  it("dedupes custom models that collide with a discovered slug", () => {
    const models = mapPiModels([sampleModel()], ["anthropic/claude-opus-4-6"]);
    expect(models).toHaveLength(1);
  });

  it("surfaces exactly the SDK-supported thinking levels, defaulting to off", () => {
    const caps = piModelCapabilities(sampleModel());
    const descriptor = caps.optionDescriptors?.[0];
    expect(descriptor?.type).toBe("select");
    if (descriptor?.type !== "select") return;
    // xhigh maps to "max" (supported); all other levels fall back to defaults.
    const ids = descriptor.options.map((o) => o.id);
    expect(ids).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);
    expect(descriptor.options.find((o) => o.isDefault)?.id).toBe("off");
  });

  it("omits the thinking descriptor for non-reasoning models", () => {
    const caps = piModelCapabilities({ reasoning: false });
    expect(caps.optionDescriptors ?? []).toEqual([]);
  });

  it("defaults reasoning models to off when thinkingLevel is unset", () => {
    const hyperGlm: PiModelShape = {
      id: "glm-5.2",
      name: "GLM-5.2",
      provider: "hyper",
      reasoning: true,
      thinkingLevelMap: { high: "high", max: "max" },
    };
    expect(resolvePiThinkingLevelForSession(hyperGlm, undefined)).toBe("off");
    expect(resolvePiThinkingLevelForSession(hyperGlm, { options: [] })).toBe("off");
  });

  it("honors an explicit thinkingLevel selection", () => {
    const hyperGlm: PiModelShape = {
      id: "glm-5.2",
      name: "GLM-5.2",
      provider: "hyper",
      reasoning: true,
      thinkingLevelMap: { high: "high", max: "max" },
    };
    expect(
      resolvePiThinkingLevelForSession(hyperGlm, {
        options: [{ id: "thinkingLevel", value: "high" }],
      }),
    ).toBe("high");
  });

  it("resolves project skill directories without project trust settings", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-agent-skill-dir-"));
    try {
      const piSkillDir = path.join(root, ".pi", "skills");
      const agentsSkillDir = path.join(root, ".agents", "skills");
      const agentSkillDir = path.join(root, ".agent", "skills");
      mkdirSync(piSkillDir, { recursive: true });
      mkdirSync(agentsSkillDir, { recursive: true });
      mkdirSync(agentSkillDir, { recursive: true });
      expect(resolvePiProjectSkillPaths(root)).toEqual([piSkillDir, agentsSkillDir, agentSkillDir]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.effect("discovers skills and prompts without executing Pi extensions", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(path.join(os.tmpdir(), "pi-provider-resources-"));
      const agentDir = path.join(root, "agent");
      try {
        const skillDir = path.join(agentDir, "skills", "librarian");
        const promptDir = path.join(agentDir, "prompts");
        const extensionDir = path.join(agentDir, "extensions");
        mkdirSync(skillDir, { recursive: true });
        mkdirSync(promptDir, { recursive: true });
        mkdirSync(extensionDir, { recursive: true });
        writeFileSync(
          path.join(skillDir, "SKILL.md"),
          "---\nname: librarian\ndescription: Research libraries\n---\nUse source evidence.\n",
        );
        writeFileSync(path.join(promptDir, "deploy.md"), "Deploy the app.\n");
        writeFileSync(
          path.join(extensionDir, "blocking.ts"),
          'throw new Error("Provider health discovery executed a Pi extension");\n',
        );

        const resources = yield* discoverPiResources({
          agentDir,
          cwd: root,
          projectTrustPolicy: "always",
        });

        expect(resources.skills.map((skill) => skill.name)).toContain("librarian");
        expect(resources.slashCommands.map((command) => command.name)).toContain("deploy");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
  );

  it("maps pi skills and prompt templates into kata skills and slash commands", () => {
    const skills = mapPiSkills([
      {
        name: "librarian",
        description: "Research libraries",
        filePath: "/skills/librarian/SKILL.md",
        baseDir: "/skills/librarian",
        sourceInfo: { source: "local", scope: "user", baseDir: "/skills/librarian" },
        disableModelInvocation: false,
      } as never,
    ]);
    expect(skills[0]).toMatchObject({
      name: "librarian",
      path: "/skills/librarian/SKILL.md",
      enabled: true,
      description: "Research libraries",
    });

    const commands = mapPiSlashCommands([
      {
        name: "deploy",
        description: "Deploy the app",
        content: "",
        filePath: "/p/deploy.md",
        sourceInfo: { source: "local" },
      } as never,
    ]);
    expect(commands[0]).toMatchObject({ name: "deploy", description: "Deploy the app" });
  });
});

describe("makePendingPiProvider", () => {
  it.effect("returns a pending snapshot before the first status check", () =>
    Effect.gen(function* () {
      const snapshot = yield* makePendingPiProvider(enabledSettings);
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.auth.status).toBe("unknown");
    }),
  );

  it.effect("trims, dedupes, and skips blank custom models in the pending snapshot", () =>
    Effect.gen(function* () {
      const settings = decodePiSettings({
        customModels: [
          "  anthropic/claude-opus-4-6  ",
          "",
          "  anthropic/claude-opus-4-6  ",
          "custom/local",
        ],
      });
      const snapshot = yield* makePendingPiProvider(settings);
      const slugs = snapshot.models.map((model) => model.slug);
      expect(slugs).toEqual(["anthropic/claude-opus-4-6", "custom/local"]);
    }),
  );
});

it.layer(NodeServices.layer)("checkPiProviderStatus", (it) => {
  const authenticatedModel: ServerProviderModel = {
    slug: "anthropic/claude-opus-4-6",
    name: "Claude Opus 4.6",
    subProvider: "anthropic",
    isCustom: false,
    capabilities: null,
  };

  it.effect("marks the provider unavailable when SDK discovery fails", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPiProviderStatus(enabledSettings, () =>
        Effect.fail(
          new PiProviderDiscoveryError({
            detail: "Cannot find module '@earendil-works/pi-coding-agent'",
          }),
        ),
      );
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.auth.status).toBe("unknown");
      expect(snapshot.message).toContain("Pi SDK provider probe failed");
    }),
  );

  it.effect("stays usable with a missing CLI binary but authenticated models", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPiProviderStatus(enabledSettings, () =>
        Effect.succeed({
          version: null,
          models: [authenticatedModel],
          skills: [],
          slashCommands: [],
        }),
      );
      expect(snapshot.installed).toBe(true);
      expect(snapshot.version).toBeNull();
      expect(snapshot.status).toBe("ready");
      expect(snapshot.auth.status).toBe("authenticated");
      expect(snapshot.models).toHaveLength(1);
    }),
  );

  it.effect("reports unauthenticated when installed with no authenticated models", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPiProviderStatus(
        decodePiSettings({ binaryPath: "/usr/local/bin/pi" }),
        () => Effect.succeed({ version: "0.80.2", models: [], skills: [], slashCommands: [] }),
      );
      expect(snapshot.installed).toBe(true);
      expect(snapshot.version).toBe("0.80.2");
      expect(snapshot.status).toBe("error");
      expect(snapshot.auth.status).toBe("unauthenticated");
      expect(snapshot.message).toContain("no authenticated models");
    }),
  );

  it.effect("reports ready when installed with authenticated models and skills", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPiProviderStatus(enabledSettings, () =>
        Effect.succeed({
          version: "0.80.2",
          models: [authenticatedModel],
          skills: [{ name: "librarian", path: "/skills/librarian/SKILL.md", enabled: true }],
          slashCommands: [{ name: "deploy", input: { hint: "Message" } }],
        }),
      );
      expect(snapshot.installed).toBe(true);
      expect(snapshot.version).toBe("0.80.2");
      expect(snapshot.status).toBe("ready");
      expect(snapshot.auth.status).toBe("authenticated");
      expect(snapshot.skills).toHaveLength(1);
      expect(snapshot.slashCommands).toHaveLength(1);
    }),
  );

  it.effect("returns a disabled snapshot when settings.enabled is false", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPiProviderStatus(decodePiSettings({ enabled: false }), () =>
        Effect.fail(new PiProviderDiscoveryError({ detail: "should not be called" })),
      );
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.auth.status).toBe("unknown");
    }),
  );
});
