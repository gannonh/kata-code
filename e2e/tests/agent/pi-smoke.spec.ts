import { writeRunManifest } from "../../src/harness/artifacts.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import {
  buildDeterministicAgentTurn,
  expectAssistantReply,
  expectTimelineWarning,
  expectToolCallWorkRow,
  interruptAgentTurn,
  selectComposerModelForProvider,
  selectRuntimeMode,
  sendAgentInstruction,
} from "../../src/flows/agentChat.ts";
import {
  configureDefaultPiProvider,
  formatPiSmokeSkipReason,
  readPiSmokeConfig,
  stagePiAgentDirectory,
} from "../../src/flows/piProvider.ts";
import { createOrOpenProject, createSeededWorkspace } from "../../src/flows/workspace.ts";
import { expect, resetAppToHome, test } from "../../src/harness/testFixtures.ts";

const piSmoke = readPiSmokeConfig();

async function configureStagedPiProvider(
  page: Parameters<typeof configureDefaultPiProvider>[0],
  runContext: Parameters<typeof stagePiAgentDirectory>[0],
): Promise<void> {
  if (!piSmoke.ok) return;
  const agentDir = await stagePiAgentDirectory(
    runContext,
    piSmoke.config.agentDir,
    piSmoke.config.model,
  );
  await configureDefaultPiProvider(page, { ...piSmoke.config, agentDir });
}

test.describe(`Pi provider smoke ${E2E_TAGS.pi}`, () => {
  test.skip(!piSmoke.ok, piSmoke.ok ? undefined : formatPiSmokeSkipReason(piSmoke.missing));
  test.describe.configure({ timeout: E2E_TIMEOUTS.piAgentTestMs });

  // Shared worker session: reset to the threads home between tests so each
  // starts from a known navigation point without re-launching Electron.
  test.beforeEach(async ({ authenticatedAppWindow }) => {
    await resetAppToHome(authenticatedAppWindow);
  });

  test("streams a deterministic response from a configured Pi model", async ({
    authenticatedAppWindow,
    runContext,
  }) => {
    if (!piSmoke.ok) return;

    await configureStagedPiProvider(authenticatedAppWindow, runContext);

    const turn = buildDeterministicAgentTurn("pi", piSmoke.config.model);
    const seededPath = await createSeededWorkspace(runContext, "pi-agent-smoke");
    await writeRunManifest(runContext);
    await createOrOpenProject(authenticatedAppWindow, seededPath);
    await selectComposerModelForProvider(authenticatedAppWindow, "Pi", turn.model);
    await sendAgentInstruction(authenticatedAppWindow, turn.prompt);
    await expectAssistantReply(authenticatedAppWindow, turn.expected, turn);
  });

  test("interrupts an in-flight Pi turn and returns to the composer", async ({
    authenticatedAppWindow,
    runContext,
  }) => {
    if (!piSmoke.ok) return;

    await configureStagedPiProvider(authenticatedAppWindow, runContext);
    const turn = buildDeterministicAgentTurn("pi", piSmoke.config.model);
    const seededPath = await createSeededWorkspace(runContext, "pi-interrupt");
    await writeRunManifest(runContext);
    await createOrOpenProject(authenticatedAppWindow, seededPath);
    await selectComposerModelForProvider(authenticatedAppWindow, "Pi", turn.model);
    // A real long-running tool call keeps the turn interruptible even when the
    // configured model can generate a long text response in under ten seconds.
    await sendAgentInstruction(
      authenticatedAppWindow,
      "Use the bash tool to run exactly `sleep 30`, wait for it to finish, then reply with only: done",
    );
    await interruptAgentTurn(authenticatedAppWindow);
    // The working indicator is gone and the composer accepts a new message.
    await expect(authenticatedAppWindow.getByRole("button", { name: "Send message" })).toBeVisible({
      timeout: E2E_TIMEOUTS.assertionMs,
    });
  });

  test("renders a tool-call work row when the Pi agent reads a file", async ({
    authenticatedAppWindow,
    runContext,
  }) => {
    if (!piSmoke.ok) return;

    await configureStagedPiProvider(authenticatedAppWindow, runContext);
    const seededPath = await createSeededWorkspace(runContext, "pi-tool-lifecycle");
    await writeRunManifest(runContext);
    await createOrOpenProject(authenticatedAppWindow, seededPath);
    await selectComposerModelForProvider(authenticatedAppWindow, "Pi", piSmoke.config.model);
    await sendAgentInstruction(
      authenticatedAppWindow,
      'Use the read tool to read package.json in the workspace root, then reply with only the exact value of the "name" field.',
    );
    await expectToolCallWorkRow(authenticatedAppWindow);
  });

  test("surfaces a runtime warning when the Pi session starts in approval-required mode", async ({
    authenticatedAppWindow,
    runContext,
  }) => {
    if (!piSmoke.ok) return;

    await configureStagedPiProvider(authenticatedAppWindow, runContext);
    const seededPath = await createSeededWorkspace(runContext, "pi-runtime-mode");
    await writeRunManifest(runContext);
    await createOrOpenProject(authenticatedAppWindow, seededPath);
    await selectComposerModelForProvider(authenticatedAppWindow, "Pi", piSmoke.config.model);
    // Supervised == approval-required. Pi cannot enforce it, so the adapter
    // emits a runtime.warning at session start that renders in the timeline.
    await selectRuntimeMode(authenticatedAppWindow, "Supervised");
    await sendAgentInstruction(authenticatedAppWindow, "Reply with the single word: ready");
    await expectTimelineWarning(authenticatedAppWindow, "approval-required");
  });
});
