import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
// @effect-diagnostics nodeBuiltinImport:off - Tests create temporary Pi skill directories.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { PiSettings, type ServerProviderModel } from "@kata-sh/code-contracts";

import {
  checkPiProviderStatus,
  PiProviderDiscoveryError,
  makePendingPiProvider,
  mapPiModels,
  mapPiSlashCommands,
  mapPiSkills,
  piModelCapabilities,
  piModelSlug,
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
