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
      { includeModels: false },
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
