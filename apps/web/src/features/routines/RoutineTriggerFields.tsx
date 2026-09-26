import { GITHUB_ROUTINE_EVENT_LABELS, type GitHubRoutineEvent } from "@kata-sh/code-contracts";

import { Input } from "../../components/ui/input";
import { FieldLabel } from "./FieldLabel";
import {
  ROUTINE_CONTROL_CLASS,
  type GitHubTriggerPatch,
  type RoutineEditorGitHubTrigger,
} from "./RoutinesPage.logic";

/** GitHub event and the filters that event supports. */
export function GitHubTriggerFields({
  trigger,
  defaultBranch,
  branches,
  labels,
  disabled,
  onTriggerChange,
}: {
  readonly trigger: RoutineEditorGitHubTrigger;
  readonly defaultBranch: string | undefined;
  readonly branches: readonly string[];
  readonly labels: readonly { readonly id: number; readonly name: string }[];
  readonly disabled: boolean;
  readonly onTriggerChange: (patch: GitHubTriggerPatch) => void;
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <FieldLabel htmlFor="routine-github-event">Event</FieldLabel>
        <select
          id="routine-github-event"
          className={ROUTINE_CONTROL_CLASS}
          value={trigger.event}
          disabled={disabled}
          onChange={(event) => onTriggerChange({ event: event.target.value as GitHubRoutineEvent })}
        >
          {(Object.entries(GITHUB_ROUTINE_EVENT_LABELS) as [GitHubRoutineEvent, string][]).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ),
          )}
        </select>
      </div>
      {trigger.event !== "issue_opened" ? (
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="routine-github-branch">
            {trigger.event === "workflow_failed" ? "Head branch" : "Base branch"} (blank for any)
          </FieldLabel>
          <Input
            id="routine-github-branch"
            list="routine-branch-options"
            value={trigger.branch ?? ""}
            onValueChange={(value) =>
              onTriggerChange({ branch: value.trim().length === 0 ? undefined : value })
            }
            placeholder={defaultBranch ?? "main"}
            disabled={disabled}
          />
          <datalist id="routine-branch-options">
            {branches.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
      ) : null}
      {trigger.event === "pr_opened" || trigger.event === "pr_updated" ? (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={trigger.includeDrafts}
            disabled={disabled}
            onChange={(event) => onTriggerChange({ includeDrafts: event.target.checked })}
          />
          Include draft pull requests
        </label>
      ) : null}
      {trigger.event === "issue_opened" ? (
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="routine-github-label">Issue label (any when unset)</FieldLabel>
          <select
            id="routine-github-label"
            className={ROUTINE_CONTROL_CLASS}
            value={trigger.issueLabelId === undefined ? "" : String(trigger.issueLabelId)}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value;
              onTriggerChange({ issueLabelId: value === "" ? undefined : Number(value) });
            }}
          >
            <option value="">Any label</option>
            {labels.map((label) => (
              <option key={label.id} value={String(label.id)}>
                {label.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Filters use GitHub's stable ids, so renamed repositories and labels keep matching. Event
        text is passed to the routine as untrusted context under the saved instruction.
      </p>
    </>
  );
}
