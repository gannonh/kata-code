# Pi Runtime Update Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Kata Code to Pi `0.80.10`, add daily grouped Pi dependency updates, and provide repeatable local, Docker, desktop E2E, and post-nightly Vercel validation.

**Architecture:** Replace Pi's removed `AuthStorage`/`ModelRegistry` SDK integration with a fresh async `ModelRuntime` at each discovery or session boundary. Keep all Pi packages and sandbox installs version-aligned, use Dependabot as the daily developer notification, and coordinate existing focused tests plus new catalog and Docker probes through one fail-loud verification command.

**Tech Stack:** TypeScript, Effect, `@earendil-works/pi-coding-agent`, Vite+ Test, Playwright Electron E2E, Docker, Dependabot, Vercel Sandbox.

## Global Constraints

- Target Pi version is exactly `0.80.10` for this migration.
- `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-agent-core` must use the same exact version.
- Create a fresh Pi model runtime for every provider discovery, adapter `startSession`, and text-generation service creation so late-seeded credentials are visible.
- Pi remains an in-process SDK provider and updates only with Kata releases.
- Dependabot checks Pi packages daily, groups them into one PR, and never auto-merges.
- Credentialed Pi verification must fail loudly when prerequisites are absent.
- E2E uses real Pi credentials and provider traffic; do not mock application or provider services.
- Vercel validation uses a fresh sandbox and the published Kata nightly artifact.
- Keep `apps/web/src/providerInstances.ts` as a local UAT-only modification until Vercel and degraded-path validation pass.
- `vp check`, `vp run typecheck`, `vp run test`, and `vp run release:smoke` must pass before completion.

---

## File Structure

### Create

- `.github/dependabot.yml` — daily grouped Pi dependency update notification.
- `scripts/piRuntimeVersion.test.ts` — deterministic alignment check for server, Docker, and Vercel Pi versions.
- `scripts/piUpdateVerification.ts` — fail-loud prerequisite validation and ordered post-update command orchestration.
- `scripts/piUpdateVerification.test.ts` — unit coverage for prerequisite and command planning behavior.
- `scripts/verifyPiDockerRuntime.ts` — staged-credential Docker SDK/model probe.
- `e2e/tests/agent/pi-catalog.spec.ts` — real model-catalog discovery and session-start smoke without custom-model registration.

### Modify

- `apps/server/package.json` — exact Pi `0.80.10` dependencies.
- `pnpm-lock.yaml` — resolved Pi `0.80.10` graph.
- `apps/server/src/provider/Layers/PiProvider.ts` — async `ModelRuntime` factory and discovery.
- `apps/server/src/provider/Layers/PiProvider.test.ts` — built-in GPT-5.6 catalog regression.
- `apps/server/src/provider/Layers/PiAdapter.ts` — fresh model runtime per session.
- `apps/server/src/provider/Layers/PiAdapter.test.ts` — late-seed runtime recreation regression.
- `apps/server/src/textGeneration/PiTextGeneration.ts` — model runtime session option.
- `apps/server/src/textGeneration/PiTextGeneration.test.ts` — model runtime injection coverage.
- `packages/sandbox-vercel/src/bootstrap.ts` — Pi `0.80.10` pin and current API rationale.
- `packages/sandbox-vercel/src/bootstrap.test.ts` — updated pin assertions.
- `Dockerfile` — exact global Pi CLI trio version.
- `e2e/src/flows/piProvider.ts` — optional custom-model registration.
- `e2e/src/config/tags.ts` — `@pi-update` tag.
- `e2e/README.md` — post-update prerequisites and command.
- `docs/guides/e2e-test-catalog.md` — Pi catalog smoke inventory.
- `package.json` — `verify:pi-update` and Docker probe scripts.
- `docs/specs/2026-07-17-pi-sandbox-support-build-report.md` — migration and UAT evidence.
- `docs/specs/2026-07-18-pi-runtime-update-strategy-design.md` — implementation outcome.
- `docs/specs/index.md` and relevant `log.md` files — final status and links.

---

### Task 1: Upgrade Pi and migrate provider discovery

**Files:**

- Modify: `apps/server/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/server/src/provider/Layers/PiProvider.ts`
- Test: `apps/server/src/provider/Layers/PiProvider.test.ts`

**Interfaces:**

- Produces: `PiModelRuntimeShape`, `PiModelRuntimeFactory`, and `createPiModelRuntime(agentDir)` for Tasks 2 and 5.
- Preserves: `PiModelShape`, `mapPiModels`, `piModelSlug`, and `discoverPiProvider` public behavior.

- [ ] **Step 1: Add the failing built-in catalog regression**

Update the Pi SDK import in `PiProvider.test.ts` and add:

```ts
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

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
```

- [ ] **Step 2: Run the regression and confirm the old SDK fails**

Run:

```bash
vp test apps/server/src/provider/Layers/PiProvider.test.ts
```

Expected: FAIL because Pi `0.80.2` does not export `ModelRuntime` and does not contain `gpt-5.6-sol`.

- [ ] **Step 3: Install the exact Pi runtime trio**

Set these dependencies in `apps/server/package.json`:

```json
"@earendil-works/pi-agent-core": "0.80.10",
"@earendil-works/pi-ai": "0.80.10",
"@earendil-works/pi-coding-agent": "0.80.10"
```

Run:

```bash
vp install
```

Expected: `pnpm-lock.yaml` resolves the Pi packages at `0.80.10`.

- [ ] **Step 4: Replace registry construction with the async runtime factory**

In `PiProvider.ts`, import `ModelRuntime` and remove `AuthStorage` from the SDK import. Replace `createPiRegistries` with:

```ts
export interface PiModelRuntimeShape {
  getAvailable(): Promise<ReadonlyArray<PiModelShape>>;
}

export type PiModelRuntimeFactory = (agentDir: string) => Promise<PiModelRuntimeShape>;

export const createPiModelRuntime: PiModelRuntimeFactory = async (agentDir) => {
  const resolvedAgentDir = resolvePiAgentDir(agentDir);
  return ModelRuntime.create({
    authPath: `${resolvedAgentDir}/auth.json`,
    modelsPath: `${resolvedAgentDir}/models.json`,
  });
};
```

Change discovery to await both runtime creation and model availability:

```ts
const modelRuntime = yield * Effect.promise(() => createPiModelRuntime(input.agentDir));
const models = yield * Effect.promise(() => modelRuntime.getAvailable());
```

Keep `mapPiModels(models, input.customModels)` unchanged.

- [ ] **Step 5: Run provider tests and typecheck the server**

Run:

```bash
vp test apps/server/src/provider/Layers/PiProvider.test.ts
vp run --filter @kata-sh/code-cli typecheck
```

Expected: PASS. The catalog regression resolves `openai-codex/gpt-5.6-sol`.

- [ ] **Step 6: Commit the provider discovery migration**

```bash
git add apps/server/package.json pnpm-lock.yaml \
  apps/server/src/provider/Layers/PiProvider.ts \
  apps/server/src/provider/Layers/PiProvider.test.ts
git commit -m "feat(pi): migrate provider discovery to ModelRuntime"
```

---

### Task 2: Migrate sessions and text generation to ModelRuntime

**Files:**

- Modify: `apps/server/src/provider/Layers/PiAdapter.ts`
- Test: `apps/server/src/provider/Layers/PiAdapter.test.ts`
- Modify: `apps/server/src/textGeneration/PiTextGeneration.ts`
- Test: `apps/server/src/textGeneration/PiTextGeneration.test.ts`

**Interfaces:**

- Consumes: `PiModelRuntimeFactory` and `createPiModelRuntime` from Task 1.
- Produces: fresh per-session runtime behavior used by local and sandbox Pi sessions.

- [ ] **Step 1: Rewrite the late-seed adapter test against ModelRuntime**

Replace the registry recreation test with a runtime test that captures the session option:

```ts
it.effect("recreates ModelRuntime on startSession after late credential seed", () =>
  Effect.gen(function* () {
    const selectedModel: PiModelShape = {
      id: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      provider: "openai-codex",
      reasoning: true,
    };
    const refreshedModelRuntime = {
      getAvailable: () => Promise.resolve([selectedModel]),
    };
    let runtimeCreations = 0;
    let sessionModelRuntime: unknown;
    const { session } = makeFakeSession();
    const adapter = yield* makePiAdapter(decodePiSettings({}), {
      instanceId: ProviderInstanceId.make("pi"),
      createModelRuntime: async () => {
        runtimeCreations += 1;
        return refreshedModelRuntime;
      },
      createSession: ((args: { modelRuntime: unknown }) => {
        sessionModelRuntime = args.modelRuntime;
        return Promise.resolve({ session });
      }) as never,
    });

    const started = yield* adapter.startSession({
      threadId: ThreadId.make("pi-thread-late-seed"),
      runtimeMode: "full-access",
      modelSelection: {
        instanceId: ProviderInstanceId.make("pi"),
        model: "openai-codex/gpt-5.6-sol",
      },
    });

    expect(started.model).toBe("openai-codex/gpt-5.6-sol");
    expect(runtimeCreations).toBe(1);
    expect(sessionModelRuntime).toBe(refreshedModelRuntime);
  }),
);
```

- [ ] **Step 2: Run the adapter test and confirm the old option fails**

Run:

```bash
vp test apps/server/src/provider/Layers/PiAdapter.test.ts -t "recreates ModelRuntime"
```

Expected: FAIL because `createModelRuntime` is not yet a `PiAdapterLiveOptions` property.

- [ ] **Step 3: Implement fresh runtime creation in `PiAdapter`**

Replace `createRegistries` with:

```ts
readonly createModelRuntime?: PiModelRuntimeFactory;
```

At `startSession`, create and read the runtime through typed errors:

```ts
const runtimeFactory = options?.createModelRuntime ?? createPiModelRuntime;
const modelRuntime =
  yield *
  Effect.tryPromise({
    try: () => runtimeFactory(agentDir),
    catch: (cause) =>
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "startSession",
        detail: `Failed to initialize Pi model runtime: ${
          cause instanceof Error ? cause.message : String(cause)
        }.`,
        cause,
      }),
  });
const discoveredModels = options?.availableModels
  ? options.availableModels
  : yield *
    Effect.tryPromise({
      try: () => modelRuntime.getAvailable(),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "startSession",
          detail: `Failed to discover authenticated Pi models: ${
            cause instanceof Error ? cause.message : String(cause)
          }.`,
          cause,
        }),
    });
const availableModels = discoveredModels as ReadonlyArray<PiModelShape>;
```

Pass this option to Pi:

```ts
modelRuntime: modelRuntime as never,
```

Remove the obsolete `authStorage` and `modelRegistry` options.

- [ ] **Step 4: Add text-generation runtime injection coverage**

Add a `createModelRuntime` option to the first text-generation test and capture the value passed to `createSession`:

```ts
const modelRuntime = { getAvailable: () => Promise.resolve(SAMPLE_MODELS) };
let receivedModelRuntime: unknown;
const textGeneration =
  yield *
  makePiTextGeneration(decodePiSettings({}), {
    createModelRuntime: async () => modelRuntime,
    createSession: ((args: { modelRuntime: unknown }) => {
      receivedModelRuntime = args.modelRuntime;
      return Promise.resolve({ session });
    }) as never,
  });

expect(receivedModelRuntime).toBe(modelRuntime);
```

Run:

```bash
vp test apps/server/src/textGeneration/PiTextGeneration.test.ts
```

Expected: FAIL because `createModelRuntime` is not yet supported.

- [ ] **Step 5: Migrate `PiTextGeneration`**

Add to `PiTextGenerationOptions`:

```ts
readonly createModelRuntime?: PiModelRuntimeFactory;
```

Replace registry construction with:

```ts
const runtimeFactory = options?.createModelRuntime ?? createPiModelRuntime;
const modelRuntime = yield * Effect.promise(() => runtimeFactory(agentDir));
const availableModels = (options?.availableModels ??
  yield * Effect.promise(() => modelRuntime.getAvailable())) as ReadonlyArray<PiModelShape>;
```

Pass `modelRuntime: modelRuntime as never` to `createAgentSession` and remove `authStorage` and `modelRegistry`.

- [ ] **Step 6: Run focused Pi tests**

Run:

```bash
vp test apps/server/src/provider/Layers/PiAdapter.test.ts \
  apps/server/src/provider/Layers/PiProvider.test.ts \
  apps/server/src/textGeneration/PiTextGeneration.test.ts
vp run --filter @kata-sh/code-cli typecheck
```

Expected: all focused tests and server typecheck PASS.

- [ ] **Step 7: Commit session and text-generation migration**

```bash
git add apps/server/src/provider/Layers/PiAdapter.ts \
  apps/server/src/provider/Layers/PiAdapter.test.ts \
  apps/server/src/textGeneration/PiTextGeneration.ts \
  apps/server/src/textGeneration/PiTextGeneration.test.ts
git commit -m "feat(pi): use ModelRuntime for agent sessions"
```

---

### Task 3: Align sandbox versions and add daily update PRs

**Files:**

- Create: `scripts/piRuntimeVersion.test.ts`
- Create: `.github/dependabot.yml`
- Modify: `packages/sandbox-vercel/src/bootstrap.ts`
- Modify: `packages/sandbox-vercel/src/bootstrap.test.ts`
- Modify: `Dockerfile`

**Interfaces:**

- Consumes: exact versions from `apps/server/package.json`.
- Produces: one deterministic version-alignment gate and one grouped daily update PR.

- [ ] **Step 1: Write the failing version-alignment test**

Create `scripts/piRuntimeVersion.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { PI_SDK_PIN } from "../packages/sandbox-vercel/src/bootstrap.ts";

const serverPackage = JSON.parse(
  readFileSync(new URL("../apps/server/package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string> };
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const PI_PACKAGES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-agent-core",
] as const;

describe("Pi runtime version alignment", () => {
  it("pins server, Vercel, and Docker to one exact version", () => {
    expect(PI_PACKAGES.map((name) => serverPackage.dependencies[name])).toEqual([
      PI_SDK_PIN,
      PI_SDK_PIN,
      PI_SDK_PIN,
    ]);
    expect(dockerfile).toContain(`ARG PI_SDK_VERSION=${PI_SDK_PIN}`);
    for (const name of PI_PACKAGES) {
      expect(dockerfile).toContain(`${name}@\${PI_SDK_VERSION}`);
    }
  });
});
```

- [ ] **Step 2: Run the alignment test and confirm sandbox drift**

Run:

```bash
vp test scripts/piRuntimeVersion.test.ts packages/sandbox-vercel/src/bootstrap.test.ts
```

Expected: FAIL because Vercel remains `0.80.2` and Docker uses an unversioned global Pi install.

- [ ] **Step 3: Update Vercel and Docker pins**

Set in `bootstrap.ts`:

```ts
export const PI_SDK_PIN = "0.80.10";
```

Rewrite its comment to state that the pin keeps the published Kata CLI and sandbox Pi binary on the tested ModelRuntime API. Preserve all three explicit package specs.

In `Dockerfile`, add immediately before the provider install:

```dockerfile
ARG PI_SDK_VERSION=0.80.10
RUN npm install -g \
    @openai/codex \
    @anthropic-ai/claude-code \
    opencode-ai \
    @xai-official/grok \
    @earendil-works/pi-coding-agent@${PI_SDK_VERSION} \
    @earendil-works/pi-ai@${PI_SDK_VERSION} \
    @earendil-works/pi-agent-core@${PI_SDK_VERSION}
```

Remove the old unversioned provider install line. Update `bootstrap.test.ts` comments from the removed `AuthStorage` failure to lockstep runtime alignment.

- [ ] **Step 4: Add grouped daily Dependabot configuration**

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: daily
    allow:
      - dependency-name: "@earendil-works/pi-*"
    groups:
      pi-runtime:
        patterns:
          - "@earendil-works/pi-*"
    open-pull-requests-limit: 1
    commit-message:
      prefix: "chore(pi)"
```

- [ ] **Step 5: Run version and bootstrap tests**

Run:

```bash
vp test scripts/piRuntimeVersion.test.ts packages/sandbox-vercel/src/bootstrap.test.ts
vp run --filter @kata-sh/code-sandbox-vercel typecheck
```

Expected: PASS with every Pi version equal to `0.80.10`.

- [ ] **Step 6: Commit update automation and alignment**

```bash
git add .github/dependabot.yml Dockerfile \
  packages/sandbox-vercel/src/bootstrap.ts \
  packages/sandbox-vercel/src/bootstrap.test.ts \
  scripts/piRuntimeVersion.test.ts
git commit -m "chore(pi): align runtime update workflow"
```

---

### Task 4: Add a real discovered-model E2E smoke

**Files:**

- Modify: `e2e/src/flows/piProvider.ts`
- Modify: `e2e/src/config/tags.ts`
- Create: `e2e/tests/agent/pi-catalog.spec.ts`
- Modify: `e2e/README.md`
- Modify: `docs/guides/e2e-test-catalog.md`

**Interfaces:**

- Produces: `configureDefaultPiProvider(page, config, options?)` with `registerCustomModel?: boolean`.
- Produces: `@pi-update`, a credentialed real-model migration gate used by Task 5.

- [ ] **Step 1: Add the failing catalog E2E spec**

Add `piUpdate: "@pi-update"` to `E2E_TAGS`, then create `e2e/tests/agent/pi-catalog.spec.ts`:

```ts
import { writeRunManifest } from "../../src/harness/artifacts.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import {
  buildDeterministicAgentTurn,
  expectAssistantReply,
  selectComposerModelForProvider,
  sendAgentInstruction,
} from "../../src/flows/agentChat.ts";
import {
  configureDefaultPiProvider,
  formatPiSmokeSkipReason,
  readPiSmokeConfig,
  stagePiAgentDirectory,
} from "../../src/flows/piProvider.ts";
import { createOrOpenProject, createSeededWorkspace } from "../../src/flows/workspace.ts";
import { test } from "../../src/harness/testFixtures.ts";

const piSmoke = readPiSmokeConfig();

test.describe(`Pi catalog migration ${E2E_TAGS.piUpdate}`, () => {
  test.skip(!piSmoke.ok, piSmoke.ok ? undefined : formatPiSmokeSkipReason(piSmoke.missing));
  test.describe.configure({ timeout: E2E_TIMEOUTS.piAgentTestMs });

  test("discovers and runs the configured built-in Pi model", async ({
    authenticatedAppWindow,
    runContext,
  }) => {
    if (!piSmoke.ok) return;
    const agentDir = await stagePiAgentDirectory(
      runContext,
      piSmoke.config.agentDir,
      piSmoke.config.model,
    );
    await configureDefaultPiProvider(
      authenticatedAppWindow,
      { ...piSmoke.config, agentDir },
      { registerCustomModel: false },
    );

    const turn = buildDeterministicAgentTurn("pi", piSmoke.config.model);
    const seededPath = await createSeededWorkspace(runContext, "pi-catalog-migration");
    await writeRunManifest(runContext);
    await createOrOpenProject(authenticatedAppWindow, seededPath);
    await selectComposerModelForProvider(authenticatedAppWindow, "Pi", turn.model);
    await sendAgentInstruction(authenticatedAppWindow, turn.prompt);
    await expectAssistantReply(authenticatedAppWindow, turn.expected, turn);
  });
});
```

- [ ] **Step 2: List the new spec and confirm the helper contract fails**

Run:

```bash
vp run e2e --list --grep @pi-update
vp run typecheck
```

Expected: the test lists, and typecheck FAILS because `configureDefaultPiProvider` does not accept the third argument.

- [ ] **Step 3: Add optional custom-model registration**

Change the flow signature:

```ts
export interface ConfigurePiProviderOptions {
  readonly registerCustomModel?: boolean;
}

export async function configureDefaultPiProvider(
  page: Page,
  config: PiSmokeConfig,
  options: ConfigurePiProviderOptions = {},
): Promise<void> {
```

Wrap the custom model mutation:

```ts
if (options.registerCustomModel !== false) {
  const customModelInput = page.locator("#provider-instance-pi-custom-model");
  await customModelInput.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
  if ((await piCard.getByText(config.model, { exact: true }).count()) === 0) {
    await customModelInput.fill(config.model);
    await customModelInput.press("Enter");
  }
}
```

The new test now proves that Pi discovery supplied the model; it cannot pass by registering the slug as a custom model.

- [ ] **Step 4: Document the gate**

Add to `e2e/README.md`:

```markdown
### Pi dependency-update validation

Set `KATACODE_E2E_ENABLE_PI=1`, `KATACODE_E2E_PI_AGENT_DIR`, and
`KATACODE_E2E_PI_MODEL` to an authenticated built-in model introduced by the
migration target. `@pi-update` does not register the model as custom, so model
selection proves the installed Pi catalog discovered it.
```

Add `pi-catalog.spec.ts` / `@pi-update` to the E2E catalog.

- [ ] **Step 5: Run static E2E checks**

Run:

```bash
vp run e2e --list --grep @pi-update
vp test e2e/src/**/*.test.ts
vp run typecheck
```

Expected: PASS and one `@pi-update` test listed.

- [ ] **Step 6: Commit the E2E catalog gate**

```bash
git add e2e/src/flows/piProvider.ts e2e/src/config/tags.ts \
  e2e/tests/agent/pi-catalog.spec.ts e2e/README.md \
  docs/guides/e2e-test-catalog.md
git commit -m "test(pi): add discovered-model E2E smoke"
```

---

### Task 5: Add the fail-loud post-update verification command

**Files:**

- Create: `scripts/piUpdateVerification.ts`
- Test: `scripts/piUpdateVerification.test.ts`
- Create: `scripts/verifyPiDockerRuntime.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `@pi-update`, existing `@pi` E2E, `PI_SDK_PIN`, Docker image `katacode:local`.
- Produces: `vp run verify:pi-update` as the maintainer gate before merging a Pi update PR.

- [ ] **Step 1: Write failing orchestration tests**

Create `scripts/piUpdateVerification.test.ts` with assertions for exact prerequisite names and command order:

```ts
import { describe, expect, it } from "vite-plus/test";
import {
  PI_UPDATE_REQUIRED_ENV,
  makePiUpdateCommands,
  readPiUpdatePrerequisites,
} from "./piUpdateVerification.ts";

describe("Pi update verification", () => {
  it("reports every missing credentialed prerequisite", () => {
    expect(() => readPiUpdatePrerequisites({})).toThrow(PI_UPDATE_REQUIRED_ENV.join(", "));
  });

  it("runs focused, static, E2E, and Docker gates in order", () => {
    const commands = makePiUpdateCommands();
    expect(commands.map((command) => command.label)).toEqual([
      "focused Pi tests",
      "repository check",
      "repository typecheck",
      "desktop build",
      "credentialed Pi E2E",
      "Docker image build",
      "Docker image baseline",
      "Docker Pi runtime",
    ]);
  });
});
```

- [ ] **Step 2: Run the test and confirm the module is absent**

Run:

```bash
vp test scripts/piUpdateVerification.test.ts
```

Expected: FAIL because `piUpdateVerification.ts` does not exist.

- [ ] **Step 3: Implement prerequisite and command planning**

Create `scripts/piUpdateVerification.ts` with these exports:

```ts
export const PI_UPDATE_REQUIRED_ENV = [
  "KATACODE_E2E_PI_AGENT_DIR",
  "KATACODE_E2E_PI_MODEL",
] as const;

export interface PiUpdateCommand {
  readonly label: string;
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
}

export function readPiUpdatePrerequisites(env: NodeJS.ProcessEnv): {
  readonly agentDir: string;
  readonly model: string;
} {
  const missing = PI_UPDATE_REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Pi update verification missing: ${missing.join(", ")}`);
  }
  return {
    agentDir: env.KATACODE_E2E_PI_AGENT_DIR!.trim(),
    model: env.KATACODE_E2E_PI_MODEL!.trim(),
  };
}

export function makePiUpdateCommands(): ReadonlyArray<PiUpdateCommand> {
  return [
    {
      label: "focused Pi tests",
      executable: "vp",
      args: [
        "test",
        "apps/server/src/provider/Layers/PiProvider.test.ts",
        "apps/server/src/provider/Layers/PiAdapter.test.ts",
        "apps/server/src/textGeneration/PiTextGeneration.test.ts",
        "packages/sandbox-vercel/src/bootstrap.test.ts",
        "scripts/piRuntimeVersion.test.ts",
      ],
    },
    { label: "repository check", executable: "vp", args: ["check"] },
    { label: "repository typecheck", executable: "vp", args: ["run", "typecheck"] },
    { label: "desktop build", executable: "vp", args: ["run", "build:desktop"] },
    {
      label: "credentialed Pi E2E",
      executable: "vp",
      args: ["run", "e2e:desktop", "--grep", "@pi"],
    },
    { label: "Docker image build", executable: "vp", args: ["run", "build:docker-image"] },
    { label: "Docker image baseline", executable: "vp", args: ["run", "verify:docker-image"] },
    { label: "Docker Pi runtime", executable: "node", args: ["scripts/verifyPiDockerRuntime.ts"] },
  ];
}
```

Add a `main` guard that validates `auth.json`, runs each command with inherited stdio, forces `KATACODE_E2E_ENABLE_PI=1`, and exits on the first non-zero status. Export the pure functions so the test does not spawn processes.

- [ ] **Step 4: Implement the Docker runtime probe**

Create `scripts/verifyPiDockerRuntime.ts`. It must:

1. Read the same required env.
2. Copy `auth.json` and optional `models.json` into `mkdtemp(join(tmpdir(), "kata-pi-update-"))`.
3. Run `docker run --rm` as the image's `katacode` user.
4. Mount the staged directory read-only at `/home/katacode/.pi/agent`.
5. Import `/app/apps/server/node_modules/@earendil-works/pi-coding-agent/dist/index.js`.
6. Create `ModelRuntime`, await `getAvailable()`, and require the configured provider/model slug.
7. Require both `pi --version` and SDK `VERSION` to equal `PI_SDK_PIN`.
8. Remove the staged directory in `finally`.

Use this probe body inside the container:

```js
const sdk =
  await import("file:///app/apps/server/node_modules/@earendil-works/pi-coding-agent/dist/index.js");
const [provider, ...modelParts] = process.env.KATACODE_E2E_PI_MODEL.split("/");
const modelId = modelParts.join("/");
const runtime = await sdk.ModelRuntime.create();
const available = await runtime.getAvailable(provider);
if (!available.some((model) => model.id === modelId)) {
  throw new Error(`Docker Pi runtime did not discover ${provider}/${modelId}`);
}
if (sdk.VERSION !== process.env.EXPECTED_PI_VERSION) {
  throw new Error(`Docker Pi SDK ${sdk.VERSION} != ${process.env.EXPECTED_PI_VERSION}`);
}
console.log(JSON.stringify({ sdkVersion: sdk.VERSION, model: `${provider}/${modelId}` }));
```

- [ ] **Step 5: Add root scripts**

Add to `package.json`:

```json
"verify:pi-docker-runtime": "node scripts/verifyPiDockerRuntime.ts",
"verify:pi-update": "node scripts/piUpdateVerification.ts"
```

- [ ] **Step 6: Run orchestration unit tests and prerequisite failure**

Run:

```bash
vp test scripts/piUpdateVerification.test.ts scripts/piRuntimeVersion.test.ts
env -u KATACODE_E2E_PI_AGENT_DIR -u KATACODE_E2E_PI_MODEL vp run verify:pi-update
```

Expected: tests PASS; verification exits non-zero and names both missing variables before starting any command.

- [ ] **Step 7: Commit the verification command**

```bash
git add package.json scripts/piUpdateVerification.ts \
  scripts/piUpdateVerification.test.ts scripts/verifyPiDockerRuntime.ts
git commit -m "test(pi): add post-update verification suite"
```

---

### Task 6: Run validation, publish the nightly, and close the Pi sandbox plan

**Files:**

- Modify: `apps/web/src/providerInstances.ts`
- Modify: `apps/web/src/providerInstances.test.ts`
- Modify: `docs/specs/2026-07-17-pi-sandbox-support-build-report.md`
- Modify: `docs/specs/2026-07-18-pi-runtime-update-strategy-design.md`
- Modify: `docs/specs/index.md`
- Modify: relevant `docs/log.md`, `docs/specs/log.md`, `docs/providers/log.md`

**Interfaces:**

- Consumes: `vp run verify:pi-update` and the nightly release workflow.
- Produces: verified local, Docker, and Vercel evidence and the permanent Pi sandbox un-gate.

- [ ] **Step 1: Run the full post-update suite with GPT-5.6 Sol**

Set:

```bash
export KATACODE_E2E_ENABLE_PI=1
export KATACODE_E2E_PI_AGENT_DIR="$HOME/.pi/agent"
export KATACODE_E2E_PI_MODEL="openai-codex/gpt-5.6-sol"
vp run verify:pi-update
```

Expected: focused tests, static checks, desktop `@pi` E2E, Docker baseline, and Docker runtime/model probe all PASS.

- [ ] **Step 2: Run CI-parity repository gates**

Run:

```bash
vp run test
vp run release:smoke
```

Expected: PASS. If an unrelated timing test fails once, rerun that exact test to gather evidence, then rerun the complete command before proceeding.

- [ ] **Step 3: Review the migration before release**

Review the branch diff for correctness (architecture smell-checks in `.agents/skills/improve-codebase-architecture/` when useful). Resolve every correctness issue, rerun affected focused tests, and commit fixes atomically.

- [ ] **Step 4: Push and publish a new nightly**

```bash
git push origin pi-sandbox-support
gh workflow run release.yml --repo gannonh/kata-code \
  --ref pi-sandbox-support -f channel=nightly
gh run list --repo gannonh/kata-code --workflow release.yml \
  --branch pi-sandbox-support --limit 1
```

Watch the returned run through `Publish CLI to npm`. Record the exact `@kata-sh/code-cli` nightly version.

- [ ] **Step 5: Verify the published artifact contains ModelRuntime migration**

```bash
VERSION=$(npm view @kata-sh/code-cli dist-tags.nightly)
TMP=$(mktemp -d)
cd "$TMP"
TAR=$(npm pack "@kata-sh/code-cli@$VERSION" --silent)
tar -xzf "$TAR"
grep -q "createPiModelRuntime" package/dist/bin.mjs
cd -
rm -rf "$TMP"
```

Expected: `grep` exits 0.

- [ ] **Step 6: Run fresh Vercel nightly UAT**

Configure the Vercel target with `KATACODE_SANDBOX_CLI_TAG=nightly`, delete the old sandbox, and create a fresh sandbox. Record evidence for:

```text
Kata CLI version: <published nightly>
Pi CLI version: 0.80.10
Pi SDK version: 0.80.10
Model: openai-codex/gpt-5.6-sol
Streaming: PASS
/workspace tool call: PASS
Interrupt: PASS
Resume: PASS
```

A failed item blocks the remaining steps.

- [ ] **Step 7: Run the degraded no-credentials path**

Create a fresh sandbox target without the Pi `auth.json` seed. Confirm Pi reports no authenticated model with a visible actionable error and does not crash `katacode serve`.

- [ ] **Step 8: Make the Pi sandbox un-gate permanent**

Keep `SANDBOX_COMING_SOON_KINDS` as:

```ts
const SANDBOX_COMING_SOON_KINDS: ReadonlySet<ProviderDriverKind> = new Set([
  ProviderDriverKind.make("opencode"),
  ProviderDriverKind.make("cursor"),
]);
```

Update `providerInstances.test.ts` so the expected dimmed IDs contain only Cursor and OpenCode. Run:

```bash
vp test apps/web/src/providerInstances.test.ts
vp check
vp run typecheck
```

Expected: PASS.

- [ ] **Step 9: Record evidence and close documentation**

Update both Pi specs and the roadmap with exact command results, nightly version, local/Docker/Vercel model evidence, degraded-path result, and final commit IDs. Run:

```bash
vp run check:okf
git diff --check
```

Expected: PASS with no missing OKF frontmatter or broken roadmap status.

- [ ] **Step 10: Commit the verified closeout**

```bash
git add apps/web/src/providerInstances.ts apps/web/src/providerInstances.test.ts \
  docs/specs/2026-07-17-pi-sandbox-support-build-report.md \
  docs/specs/2026-07-18-pi-runtime-update-strategy-design.md \
  docs/specs/index.md docs/log.md docs/specs/log.md docs/providers/log.md
git commit -m "feat(pi): enable verified sandbox runtime"
```

- [ ] **Step 11: Confirm final repository state**

Run:

```bash
git status --short
vp check
vp run typecheck
vp run test
vp run release:smoke
```

Expected: clean worktree and all commands PASS.
