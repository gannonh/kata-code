import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { RoutineDraftModelOutput } from "@kata-sh/code-contracts";

import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildRoutineDraftPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  normalizeCliError,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "./TextGenerationUtils.ts";
import { TextGenerationError } from "@kata-sh/code-contracts";

describe("buildCommitMessagePrompt", () => {
  it("includes staged patch and summary in the prompt", () => {
    const result = buildCommitMessagePrompt({
      branch: "main",
      stagedSummary: "M README.md",
      stagedPatch: "diff --git a/README.md b/README.md\n+hello",
      includeBranch: false,
    });

    expect(result.prompt).toContain("Staged files:");
    expect(result.prompt).toContain("M README.md");
    expect(result.prompt).toContain("Staged patch:");
    expect(result.prompt).toContain("diff --git a/README.md b/README.md");
    expect(result.prompt).toContain("Branch: main");
    // Should NOT include the branch generation instruction
    expect(result.prompt).not.toContain("branch must be a short semantic git branch fragment");
  });

  it("includes branch generation instruction when includeBranch is true", () => {
    const result = buildCommitMessagePrompt({
      branch: "feature/foo",
      stagedSummary: "M README.md",
      stagedPatch: "diff",
      includeBranch: true,
    });

    expect(result.prompt).toContain("branch must be a short semantic git branch fragment");
    expect(result.prompt).toContain("Return a JSON object with keys: subject, body, branch.");
  });

  it("shows (detached) when branch is null", () => {
    const result = buildCommitMessagePrompt({
      branch: null,
      stagedSummary: "M a.ts",
      stagedPatch: "diff",
      includeBranch: false,
    });

    expect(result.prompt).toContain("Branch: (detached)");
  });

  it("includes policy instructions", () => {
    const result = buildCommitMessagePrompt({
      branch: "main",
      stagedSummary: "M a.ts",
      stagedPatch: "diff",
      includeBranch: false,
      policy: {
        kind: "custom",
        commitInstructions: "Use a terse repository-specific subject.",
        inferRepositoryConventions: false,
      },
    });

    expect(result.prompt).toContain("Additional instructions:");
    expect(result.prompt).toContain("Use a terse repository-specific subject.");
  });
});

describe("buildRoutineDraftPrompt", () => {
  it("limits generated fields and excludes permission/workspace output", () => {
    const result = buildRoutineDraftPrompt({
      message: "Create a weekday summary at 9am",
      currentDraft: null,
      history: [],
      projectId: "project-1",
      projects: [{ id: "project-1", title: "Kata Code" }],
      availableModels: [{ instanceId: "codex", model: "gpt-6-astra", name: "GPT-6 Astra" }],
      generationModelSelection: { instanceId: "codex", model: "gpt-6-astra" },
      eventSources: [],
    });

    expect(result.prompt).toContain("exactly these keys: draft, assistantMessage");
    expect(result.prompt).toContain("Do not return runtimeMode, workspace");
    expect(result.prompt).toContain("project-1: Kata Code");
    expect(result.prompt).toContain('"instanceId": "codex"');
    expect(result.prompt).toContain('"model": "gpt-6-astra"');
    expect(result.prompt).toContain(
      "Copy modelSelection.instanceId and modelSelection.model verbatim",
    );
    expect(result.outputSchema).toBeDefined();
  });

  it("lists Linear event sources and states that other providers are unsupported", () => {
    const result = buildRoutineDraftPrompt({
      message: "When a Linear issue is created, triage it",
      currentDraft: null,
      history: [],
      projectId: "project-1",
      projects: [{ id: "project-1", title: "Kata Code" }],
      availableModels: [{ instanceId: "codex", model: "gpt-6-astra", name: "GPT-6 Astra" }],
      generationModelSelection: { instanceId: "codex", model: "gpt-6-astra" },
      eventSources: [
        {
          connectionId: "linear-connection-1",
          provider: "linear",
          workspaceId: "workspace-uuid",
          workspaceName: "Acme",
          teams: [{ id: "team-uuid", name: "Engineering", key: "ENG" }],
          projects: [{ id: "project-uuid", name: "Roadmap", teamIds: ["team-uuid"] }],
          states: [{ id: "state-uuid", name: "In Progress", teamId: "team-uuid", type: "started" }],
          labels: [{ id: "label-uuid", name: "Bug", teamId: "team-uuid" }],
        },
      ],
    });

    expect(result.prompt).toContain("linear-connection-1");
    expect(result.prompt).toContain("workspace-uuid");
    expect(result.prompt).toContain("team-uuid");
    expect(result.prompt).toContain("state-uuid");
    expect(result.prompt).toMatch(/GitHub, Slack, Microsoft Teams, Sentry, PagerDuty.*unsupported/);
    expect(result.prompt).toMatch(/status_changed requires stateId/);
    expect(result.prompt).toMatch(/label_added requires labelId/);
    expect(result.prompt).toContain("Always include teamId and projectId.");
    expect(result.prompt).toContain("use null for an unscoped teamId or projectId");
    expect(result.prompt).toContain(
      "A null teamId or projectId means every team or project inside the connection scope.",
    );
  });

  it("keeps every paginated Linear resource available to chat generation", () => {
    const result = buildRoutineDraftPrompt({
      message: "Use the last project, status, and label",
      currentDraft: null,
      history: [],
      projectId: "project-1",
      projects: [{ id: "project-1", title: "Kata Code" }],
      availableModels: [{ instanceId: "codex", model: "gpt-6-astra", name: "GPT-6 Astra" }],
      generationModelSelection: { instanceId: "codex", model: "gpt-6-astra" },
      eventSources: [
        {
          connectionId: "linear-connection-1",
          provider: "linear",
          workspaceId: "workspace-uuid",
          workspaceName: "Acme",
          teams: Array.from({ length: 51 }, (_, index) => ({
            id: `team-${index + 1}`,
            name: `Team ${index + 1}`,
            key: `T${index + 1}`,
          })),
          projects: Array.from({ length: 51 }, (_, index) => ({
            id: `project-${index + 1}`,
            name: `Project ${index + 1}`,
            teamIds: [`team-${index + 1}`],
          })),
          states: Array.from({ length: 101 }, (_, index) => ({
            id: `state-${index + 1}`,
            name: `State ${index + 1}`,
            teamId: "team-1",
            type: "started",
          })),
          labels: Array.from({ length: 101 }, (_, index) => ({
            id: `label-${index + 1}`,
            name: `Label ${index + 1}`,
            teamId: "team-1",
          })),
        },
      ],
    });

    expect(result.prompt).toContain('"id": "team-51"');
    expect(result.prompt).toContain('"id": "project-51"');
    expect(result.prompt).toContain('"id": "state-101"');
    expect(result.prompt).toContain('"id": "label-101"');
  });
});


describe("buildPrContentPrompt", () => {
  it("includes branch names, commits, and diff in the prompt", () => {
    const result = buildPrContentPrompt({
      baseBranch: "main",
      headBranch: "feature/auth",
      commitSummary: "feat: add login page",
      diffSummary: "3 files changed",
      diffPatch: "diff --git a/auth.ts b/auth.ts\n+export function login()",
    });

    expect(result.prompt).toContain("Base branch: main");
    expect(result.prompt).toContain("Head branch: feature/auth");
    expect(result.prompt).toContain("Commits:");
    expect(result.prompt).toContain("feat: add login page");
    expect(result.prompt).toContain("Diff stat:");
    expect(result.prompt).toContain("3 files changed");
    expect(result.prompt).toContain("Diff patch:");
    expect(result.prompt).toContain("export function login()");
    expect(result.prompt).toContain("include headings '## Summary' and '## Testing'");
  });

  it("follows a repository PR template instead of the default body headings", () => {
    const result = buildPrContentPrompt({
      baseBranch: "main",
      headBranch: "feature/auth",
      commitSummary: "feat: add login page",
      diffSummary: "3 files changed",
      diffPatch: "diff",
      changeRequestTemplate: "<!-- remove me -->\n## What changed\n\n## Verification",
      policy: {
        kind: "custom",
        changeRequestInstructions: "Keep the title in sentence case.",
        inferRepositoryConventions: false,
      },
    });

    expect(result.prompt).toContain("Keep the title in sentence case.");
    expect(result.prompt).toContain("follow the repository change request template structure");
    expect(result.prompt).toContain("drop HTML comments from the template");
    expect(result.prompt).toContain("Repository change request template:");
    expect(result.prompt).toContain("<!-- remove me -->\n## What changed\n\n## Verification");
    expect(result.prompt).not.toContain("include headings '## Summary' and '## Testing'");
  });
});

describe("buildBranchNamePrompt", () => {
  it("includes the user message in the prompt", () => {
    const result = buildBranchNamePrompt({
      message: "Fix the login timeout bug",
    });

    expect(result.prompt).toContain("User message:");
    expect(result.prompt).toContain("Fix the login timeout bug");
    expect(result.prompt).not.toContain("Attachment metadata:");
  });

  it("includes attachment metadata when attachments are provided", () => {
    const result = buildBranchNamePrompt({
      message: "Fix the layout from screenshot",
      attachments: [
        {
          type: "image" as const,
          id: "att-123",
          name: "screenshot.png",
          mimeType: "image/png",
          sizeBytes: 12345,
        },
      ],
    });

    expect(result.prompt).toContain("Attachment metadata:");
    expect(result.prompt).toContain("screenshot.png");
    expect(result.prompt).toContain("image/png");
    expect(result.prompt).toContain("12345 bytes");
  });
});

describe("buildThreadTitlePrompt", () => {
  it("requires each generated field in the strict response schema", () => {
    const { outputSchema } = buildThreadTitlePrompt({ message: "Fix this" });
    expect(toJsonSchemaObject(outputSchema)).toMatchObject({
      required: ["title", "needsRefinement"],
      properties: { title: { type: "string" }, needsRefinement: { type: "boolean" } },
    });
  });

  it("includes the user message without absent attachment metadata", () => {
    const result = buildThreadTitlePrompt({
      message: "Investigate reconnect regressions after session restore",
    });

    expect(result.prompt).toContain("User message:");
    expect(result.prompt).toContain("Investigate reconnect regressions after session restore");
    expect(result.prompt).not.toContain("Attachment metadata:");
    expect(result.prompt).toContain(
      "Generate a title that will help the user recognize this Kata Code thread weeks later.",
    );
    expect(result.prompt).toContain(
      "Title the subject and outcome. Discard incidental instructions.",
    );
    expect(result.prompt).toContain(
      "Name the product change, not the mock, plan, report, branch, or PR used to produce it.",
    );
  });

  it("includes attachment metadata when attachments are provided", () => {
    const result = buildThreadTitlePrompt({
      message: "Name this thread from the screenshot",
      attachments: [
        {
          type: "image" as const,
          id: "att-456",
          name: "thread.png",
          mimeType: "image/png",
          sizeBytes: 67890,
        },
      ],
    });

    expect(result.prompt).toContain("Attachment metadata:");
    expect(result.prompt).toContain("thread.png");
    expect(result.prompt).toContain("image/png");
    expect(result.prompt).toContain("67890 bytes");
  });

  it("regenerates from recent thread contents and identifies the previous title", () => {
    const result = buildThreadTitlePrompt({
      message: `USER:\nInvestigate reconnect regressions\n\nASSISTANT:\nThe remaining issue is stale session state`,
      previousTitle: "Investigate reconnect regressions",
    });

    expect(result.prompt).toContain(
      "Regenerate the title for an existing Kata Code thread so the user can recognize it weeks later.",
    );
    expect(result.prompt).toContain('The previous title was "Investigate reconnect regressions".');
    expect(result.prompt).toContain("Thread contents:");
    expect(result.prompt).toContain("The remaining issue is stale session state");
  });

  it("keeps the latest thread contents when regeneration context is truncated", () => {
    const result = buildThreadTitlePrompt({
      message: `${"old context ".repeat(1_000)}\n\nASSISTANT:\nCurrent thread state`,
      previousTitle: "Old title",
    });

    expect(result.prompt).toContain("[Earlier content truncated]");
    expect(result.prompt).toContain("Current thread state");
    expect(result.prompt).not.toContain("[truncated]");
  });

  it("does not truncate an already-marked regeneration context twice", () => {
    const retainedContext = "x".repeat(7_998);
    const result = buildThreadTitlePrompt({
      message: `[Earlier content truncated]\n\n${retainedContext}`,
      previousTitle: "Old title",
    });

    expect(result.prompt).toContain(
      `Thread contents:\n[Earlier content truncated]\n\n${retainedContext}`,
    );
    expect(result.prompt.match(/\[Earlier content truncated\]/g)).toHaveLength(1);
  });
});

describe("sanitizeThreadTitle", () => {
  it.each([
    '{"title": "Refresh ev-stg APP ASG instances"}',
    '{\n  "title": "Refresh ev-stg APP ASG instances"\n}',
  ])("unwraps a JSON title before normalizing: %s", (raw) => {
    expect(sanitizeThreadTitle(raw)).toBe("Refresh ev-stg APP ASG instances");
  });

  it.each([
    "Rolling ES Refresh ev-stg",
    "Fix {title} interpolation",
    '{"title": 42}',
    '{"subject": "Fix parsing"}',
    '{"title": "unfinished}',
  ])("preserves text that is not a JSON title: %s", (raw) => {
    expect(sanitizeThreadTitle(raw)).toBe(raw);
  });

  it("normalizes the extracted title", () => {
    expect(sanitizeThreadTitle('{"title": "  Fix   reconnect failures  "}')).toBe(
      "Fix reconnect failures",
    );
    expect(sanitizeThreadTitle('{"title": "  "}')).toBe("New thread");
    expect(
      sanitizeThreadTitle(
        '{"title": "Reconnect failures after restart because the session state does not recover"}',
      ),
    ).toBe("Reconnect failures after restart because the session state does not recover");
  });

  it("keeps complete titles for client display truncation", () => {
    expect(
      sanitizeThreadTitle(
        '  "Reconnect failures after restart because the session state does not recover"  ',
      ),
    ).toBe("Reconnect failures after restart because the session state does not recover");
  });

  it("caps runaway titles so a paragraph cannot reach the sidebar", () => {
    const words = Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ");
    const title = sanitizeThreadTitle(words);
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith("...")).toBe(true);
  });
});

describe("normalizeCliError", () => {
  it("detects 'Command not found' and includes CLI name in the message", () => {
    const error = normalizeCliError(
      "claude",
      "generateCommitMessage",
      new Error("Command not found: claude"),
      "Something went wrong",
    );

    expect(error).toBeInstanceOf(TextGenerationError);
    expect(error.detail).toContain("Claude CLI");
    expect(error.detail).toContain("not available on PATH");
  });

  it("uses the CLI name from the first argument for codex", () => {
    const error = normalizeCliError(
      "codex",
      "generateBranchName",
      new Error("Command not found: codex"),
      "Something went wrong",
    );

    expect(error).toBeInstanceOf(TextGenerationError);
    expect(error.detail).toContain("Codex CLI");
    expect(error.detail).toContain("not available on PATH");
  });

  it("returns the error as-is if it is already a TextGenerationError", () => {
    const existing = new TextGenerationError({
      operation: "generatePrContent",
      detail: "Already wrapped",
    });

    const result = normalizeCliError("claude", "generatePrContent", existing, "fallback");

    expect(result).toBe(existing);
  });

  it("wraps unknown non-Error values with the fallback message", () => {
    const result = normalizeCliError("codex", "generateCommitMessage", "string error", "fallback");

    expect(result).toBeInstanceOf(TextGenerationError);
    expect(result.detail).toBe("fallback");
  });

  it("does not expose CLI failure details in the public error message", () => {
    const result = normalizeCliError(
      "codex",
      "generateCommitMessage",
      new Error("request failed with access_token=secret-token"),
      "Failed to generate a commit message",
    );

    expect(result.detail).toBe("Failed to generate a commit message");
    expect(result.message).not.toContain("secret-token");
  });
});

describe("decodeStrictRoutineDraftModelOutput", () => {
  it("rejects permission and workspace fields from provider output", () => {
    const output = {
      draft: {
        name: "Daily brief",
        instruction: "Summarize changes",
        projectId: "project-1",
        modelSelection: { instanceId: "codex", model: "gpt-6-astra" },
        trigger: { kind: "daily", time: "09:00", timezone: "UTC" },
        runtimeMode: "full-access",
        workspace: { kind: "shared", directory: "/tmp" },
      },
      assistantMessage: "Drafted a daily brief.",
    };
    const decode = Schema.decodeUnknownSync(RoutineDraftModelOutput, {
      onExcessProperty: "error",
    });
    expect(() => decode(output)).toThrow(/excess property|unexpected key/i);
  });

  it("accepts an explicit clarification envelope", () => {
    expect(
      Schema.decodeUnknownSync(RoutineDraftModelOutput, {
        onExcessProperty: "error",
      })({ draft: null, assistantMessage: "Which time zone should I use?" }).draft,
    ).toBeNull();
  });
});
