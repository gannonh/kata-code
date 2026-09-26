import {
  GITHUB_ROUTINE_EVENT_LABELS,
  LINEAR_ROUTINE_EVENT_LABELS,
  type GitHubRoutineEvent,
  type LinearRoutineConnection,
  type LinearRoutineEvent,
  type RoutineLinearMetadata,
  type ScheduleTrigger,
  type EnvironmentId,
} from "@kata-sh/code-contracts";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useEnvironmentQuery } from "../../state/query";
import { routineEnvironment } from "../../state/routines";
import { FieldLabel } from "./FieldLabel";
import {
  ROUTINE_CONTROL_CLASS,
  ROUTINE_WHEN_TO_RUN_ACTIONS_CLASS,
  type GitHubTriggerPatch,
  type LinearTriggerPatch,
  type RoutineEditorGitHubTrigger,
  type RoutineEditorLinearTrigger,
} from "./RoutinesPage.logic";

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

/**
 * Linear event and its team, project, status, and label filters. Pickers list
 * only what `connection` is authorized for.
 */
export function LinearTriggerFields({
  trigger,
  connection,
  metadata,
  metadataError,
  disabled,
  onTriggerChange,
}: {
  readonly trigger: RoutineEditorLinearTrigger;
  readonly connection: LinearRoutineConnection | undefined;
  readonly metadata: RoutineLinearMetadata | null;
  readonly metadataError: string | null;
  readonly disabled: boolean;
  readonly onTriggerChange: (patch: LinearTriggerPatch) => void;
}) {
  const stateId = "stateId" in trigger ? trigger.stateId : undefined;
  const labelId = "labelId" in trigger ? trigger.labelId : undefined;
  const connectionTeamIds = connection?.teamIds ?? [];
  const connectionTeams = (metadata?.teams ?? []).filter((team) =>
    connection?.allTeams ? team.visibility === "public" : connectionTeamIds.includes(team.id),
  );
  const authorizedTeamIds = new Set(connectionTeams.map((team) => team.id));
  const availableProjects = (metadata?.projects ?? []).filter(
    (project) =>
      project.teamIds.some((id) => authorizedTeamIds.has(id)) &&
      (trigger.teamId === undefined || project.teamIds.includes(trigger.teamId)),
  );
  const selectedProject = availableProjects.find((project) => project.id === trigger.projectId);
  const selectedProjectTeamIds = new Set(selectedProject?.teamIds ?? []);
  const matchesSelectedScope = (candidateTeamId: string): boolean =>
    trigger.teamId !== undefined
      ? candidateTeamId === trigger.teamId
      : selectedProject === undefined || selectedProjectTeamIds.has(candidateTeamId);
  const availableStates = (metadata?.states ?? []).filter(
    (state) => authorizedTeamIds.has(state.teamId) && matchesSelectedScope(state.teamId),
  );
  const availableLabels = (metadata?.labels ?? []).filter(
    (label) =>
      label.teamId === null ||
      (authorizedTeamIds.has(label.teamId) && matchesSelectedScope(label.teamId)),
  );

  if (metadataError !== null) return <p className="text-xs text-destructive">{metadataError}</p>;
  return (
    <>
      <div className="grid gap-1.5">
        <FieldLabel htmlFor="routine-linear-event">Event</FieldLabel>
        <select
          id="routine-linear-event"
          className={ROUTINE_CONTROL_CLASS}
          value={trigger.event}
          disabled={disabled}
          onChange={(event) => onTriggerChange({ event: event.target.value as LinearRoutineEvent })}
        >
          {(Object.entries(LINEAR_ROUTINE_EVENT_LABELS) as [LinearRoutineEvent, string][]).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ),
          )}
        </select>
      </div>
      <div className="grid gap-1.5">
        <FieldLabel htmlFor="routine-linear-team">Team</FieldLabel>
        <select
          id="routine-linear-team"
          className={ROUTINE_CONTROL_CLASS}
          value={trigger.teamId ?? ""}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value;
            onTriggerChange({
              teamId: value === "" ? undefined : value,
              projectId: undefined,
              stateId: undefined,
              labelId: undefined,
            });
          }}
        >
          <option value="">All teams in this connection</option>
          {connectionTeams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <FieldLabel htmlFor="routine-linear-project">Project</FieldLabel>
        <select
          id="routine-linear-project"
          className={ROUTINE_CONTROL_CLASS}
          value={trigger.projectId ?? ""}
          disabled={disabled}
          onChange={(event) =>
            onTriggerChange({
              projectId: event.target.value === "" ? undefined : event.target.value,
              stateId: undefined,
              labelId: undefined,
            })
          }
        >
          <option value="">All projects</option>
          {availableProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      {trigger.event === "status_changed" ? (
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="routine-linear-state">Status</FieldLabel>
          <select
            id="routine-linear-state"
            className={ROUTINE_CONTROL_CLASS}
            value={stateId ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onTriggerChange({
                stateId: event.target.value === "" ? undefined : event.target.value,
              })
            }
          >
            <option value="">Choose a status</option>
            {availableStates.map((state) => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </select>
          {stateId === undefined ? (
            <p className="text-xs text-warning-foreground">
              Choose the status transition that should start the routine.
            </p>
          ) : null}
        </div>
      ) : null}
      {trigger.event === "label_added" ? (
        <div className="grid gap-1.5">
          <FieldLabel htmlFor="routine-linear-label">Label</FieldLabel>
          <select
            id="routine-linear-label"
            className={ROUTINE_CONTROL_CLASS}
            value={labelId ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onTriggerChange({
                labelId: event.target.value === "" ? undefined : event.target.value,
              })
            }
          >
            <option value="">Choose a label</option>
            {availableLabels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
          {labelId === undefined ? (
            <p className="text-xs text-warning-foreground">
              Choose the label whose addition should start the routine.
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Filters use Linear&apos;s stable ids, so renamed teams, projects, statuses, and labels keep
        matching. Event text is passed to the routine as untrusted context under the saved
        instruction.
      </p>
    </>
  );
}

function formatDateInTimezone(value: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
      timeZoneName: "shortOffset",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function ScheduleTriggerFields({
  environmentId,
  trigger,
  onTriggerChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: ScheduleTrigger;
  readonly onTriggerChange: (trigger: ScheduleTrigger) => void;
}) {
  const preview = useEnvironmentQuery(
    routineEnvironment.preview({ environmentId, input: { trigger } }),
  );
  return (
    <>
      <div className={ROUTINE_WHEN_TO_RUN_ACTIONS_CLASS}>
        {(["daily", "weekdays", "weekly", "cron"] as const).map((kind) => (
          <Button
            key={kind}
            size="sm"
            className="min-w-0 shrink"
            variant={trigger.kind === kind ? "default" : "outline"}
            onClick={() => {
              if (kind === "cron")
                onTriggerChange({ kind, expression: "0 9 * * 1-5", timezone: "UTC" });
              else if (kind === "weekly")
                onTriggerChange({ kind, weekday: 1, time: "09:00", timezone: "UTC" });
              else onTriggerChange({ kind, time: "09:00", timezone: "UTC" });
            }}
          >
            {kind[0]!.toUpperCase() + kind.slice(1)}
          </Button>
        ))}
      </div>
      {trigger.kind === "cron" ? (
        <Input
          aria-label="Cron expression"
          value={trigger.expression}
          onValueChange={(value) => onTriggerChange({ ...trigger, expression: value })}
          placeholder="0 9 * * 1-5"
        />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Input
            aria-label="Schedule time"
            type="time"
            value={trigger.time}
            onValueChange={(value) => onTriggerChange({ ...trigger, time: value })}
          />
          {trigger.kind === "weekly" ? (
            <select
              aria-label="Weekday"
              className={ROUTINE_CONTROL_CLASS}
              value={String(trigger.weekday)}
              onChange={(event) =>
                onTriggerChange({ ...trigger, weekday: Number(event.target.value) })
              }
            >
              <option value="1">Monday</option>
              <option value="2">Tuesday</option>
              <option value="3">Wednesday</option>
              <option value="4">Thursday</option>
              <option value="5">Friday</option>
              <option value="6">Saturday</option>
              <option value="0">Sunday</option>
            </select>
          ) : (
            <span />
          )}
        </div>
      )}
      <Input
        aria-label="IANA timezone"
        value={trigger.timezone}
        onValueChange={(value) => onTriggerChange({ ...trigger, timezone: value })}
        placeholder="America/Los_Angeles"
      />
      {preview.data ? (
        <div className="grid gap-1 text-xs text-muted-foreground">
          <span>Next runs</span>
          {preview.data.dates.map((date) => (
            <span key={date}>{formatDateInTimezone(date, trigger.timezone)}</span>
          ))}
        </div>
      ) : preview.error ? (
        <p className="text-xs text-destructive">{preview.error}</p>
      ) : null}
    </>
  );
}
