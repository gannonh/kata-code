import { writeRunManifest } from "../../src/harness/artifacts.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import {
  assertAgentPrerequisites,
  expectAssistantReply,
  selectComposerModel,
  sendAgentInstruction,
} from "../../src/flows/agentChat.ts";
import { createOrOpenProject, createSeededWorkspace } from "../../src/flows/workspace.ts";
import { test } from "../../src/harness/testFixtures.ts";

test.describe(`Deterministic agent chat ${E2E_TAGS.agent}`, () => {
  test.describe.configure({ timeout: E2E_TIMEOUTS.agentTestMs });

  test("returns the exact expected assistant message from a real provider", async ({
    authenticatedAppWindow,
    runContext,
  }) => {
    const turn = assertAgentPrerequisites("deterministic agent chat");

    const seededPath = await createSeededWorkspace(runContext, "agent-chat-basic");
    await writeRunManifest(runContext);
    await createOrOpenProject(authenticatedAppWindow, seededPath);
    await selectComposerModel(authenticatedAppWindow, turn.model);
    await sendAgentInstruction(authenticatedAppWindow, turn.prompt);
    await expectAssistantReply(authenticatedAppWindow, turn.expected, turn);
  });
});
