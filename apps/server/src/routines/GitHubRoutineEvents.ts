import type { GitHubEventTrigger, GitHubRoutineEvent } from "@kata-sh/code-contracts";

/**
 * A GitHub webhook delivery reduced to the fields routines filter on. Everything
 * here comes from an untrusted payload; it is matched against saved filters and
 * rendered as bounded context, never interpreted as instructions.
 */
export interface GitHubRoutineEventSummary {
  readonly event: GitHubRoutineEvent;
  readonly repositoryId: number;
  readonly repositoryName: string;
  readonly number: number | null;
  readonly title: string;
  readonly url: string;
  readonly actor: string;
  /** Base branch for pull requests, head branch for workflow runs. */
  readonly branch: string | null;
  readonly draft: boolean;
  readonly labelIds: ReadonlyArray<number>;
  readonly conclusion: string | null;
  /** Provider ids that identify the resource across renames. */
  readonly resourceId: number | null;
}

const PR_UPDATED_ACTIONS = new Set(["synchronize", "reopened", "ready_for_review"]);
const WORKFLOW_FAILURE_CONCLUSIONS = new Set(["failure", "timed_out", "action_required"]);
const BRANCH_FILTER_EVENTS = new Set<GitHubRoutineEvent>([
  "pr_opened",
  "pr_updated",
  "workflow_failed",
]);
const MAX_TEXT = 200;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asId = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
const bounded = (value: string | null): string =>
  (value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);

/** Reads the repository id GitHub places on every repository webhook payload. */
export function payloadRepositoryId(payload: unknown): number | null {
  const repository = asRecord(asRecord(payload)?.repository);
  return asId(repository?.id);
}

/**
 * Maps a raw `X-GitHub-Event` name and payload to a routine event, or null when
 * the delivery is not one routines can run on. `pull_request/edited` is excluded
 * on purpose: title and body edits would start a run per keystroke.
 */
export function summarizeGitHubEvent(
  eventName: string,
  payload: unknown,
): GitHubRoutineEventSummary | null {
  const body = asRecord(payload);
  if (!body) return null;
  const repository = asRecord(body.repository);
  const repositoryId = asId(repository?.id);
  if (repositoryId === null) return null;
  const repositoryName = bounded(asString(repository?.full_name));
  const actor = bounded(asString(asRecord(body.sender)?.login));
  const action = asString(body.action);
  if (eventName === "pull_request") {
    const pull = asRecord(body.pull_request);
    if (!pull) return null;
    const event: GitHubRoutineEvent | null =
      action === "opened"
        ? "pr_opened"
        : action !== null && PR_UPDATED_ACTIONS.has(action)
          ? "pr_updated"
          : null;
    if (event === null) return null;
    return {
      event,
      repositoryId,
      repositoryName,
      number: asId(pull.number),
      title: bounded(asString(pull.title)),
      url: bounded(asString(pull.html_url)),
      actor,
      branch: asString(asRecord(pull.base)?.ref),
      draft: pull.draft === true,
      labelIds: labelIds(pull.labels),
      conclusion: null,
      resourceId: asId(pull.id),
    };
  }
  if (eventName === "issues") {
    if (action !== "opened") return null;
    const issue = asRecord(body.issue);
    if (!issue) return null;
    return {
      event: "issue_opened",
      repositoryId,
      repositoryName,
      number: asId(issue.number),
      title: bounded(asString(issue.title)),
      url: bounded(asString(issue.html_url)),
      actor,
      branch: null,
      draft: false,
      labelIds: labelIds(issue.labels),
      conclusion: null,
      resourceId: asId(issue.id),
    };
  }
  if (eventName === "workflow_run") {
    if (action !== "completed") return null;
    const run = asRecord(body.workflow_run);
    if (!run) return null;
    const conclusion = asString(run.conclusion);
    if (conclusion === null || !WORKFLOW_FAILURE_CONCLUSIONS.has(conclusion)) return null;
    return {
      event: "workflow_failed",
      repositoryId,
      repositoryName,
      number: asId(run.run_number),
      title: bounded(asString(run.name) ?? asString(run.display_title)),
      url: bounded(asString(run.html_url)),
      actor,
      branch: asString(run.head_branch),
      draft: false,
      labelIds: [],
      conclusion,
      resourceId: asId(run.id),
    };
  }
  return null;
}

function labelIds(value: unknown): ReadonlyArray<number> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((label) => {
    const id = asId(asRecord(label)?.id);
    return id === null ? [] : [id];
  });
}

/** Decides whether a saved trigger admits a summarized delivery. */
export function triggerMatchesEvent(
  trigger: GitHubEventTrigger,
  summary: GitHubRoutineEventSummary,
): boolean {
  if (trigger.event !== summary.event) return false;
  if (trigger.repositoryId !== summary.repositoryId) return false;
  // The branch filter applies to pull requests and workflows only; issue
  // deliveries carry no branch and must not be rejected by a saved default.
  if (
    trigger.branch !== undefined &&
    BRANCH_FILTER_EVENTS.has(summary.event) &&
    trigger.branch !== summary.branch
  )
    return false;
  if (!trigger.includeDrafts && summary.draft) return false;
  if (trigger.issueLabelId !== undefined && !summary.labelIds.includes(trigger.issueLabelId))
    return false;
  return true;
}

/** Bounded, untrusted context appended below the saved instruction. */
export function formatEventContext(summary: GitHubRoutineEventSummary): string {
  const lines = [
    "GitHub event context (untrusted, provided by the webhook payload):",
    `- Event: ${summary.event}`,
    `- Repository: ${summary.repositoryName}`,
  ];
  if (summary.number !== null) lines.push(`- Number: ${summary.number}`);
  if (summary.title) lines.push(`- Title: ${summary.title}`);
  if (summary.url) lines.push(`- URL: ${summary.url}`);
  if (summary.actor) lines.push(`- Actor: ${summary.actor}`);
  if (summary.branch) lines.push(`- Branch: ${bounded(summary.branch)}`);
  if (summary.conclusion) lines.push(`- Conclusion: ${summary.conclusion}`);
  return lines.join("\n");
}
