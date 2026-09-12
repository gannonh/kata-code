import * as Cron from "effect/Cron";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  MessageId,
  CommandId,
  TurnId,
  IsoDateTime,
  TrimmedNonEmptyString,
  PositiveInt,
  NonNegativeInt,
} from "./baseSchemas.ts";
import { ModelSelection, RuntimeMode } from "./orchestration.ts";
import { RoutineOwnerGeneration, RoutineProviderSubmission, RoutineRunId } from "./routineFence.ts";

export { RoutineOwnerGeneration, RoutineProviderSubmission, RoutineRunId } from "./routineFence.ts";

export const RoutineId = TrimmedNonEmptyString.pipe(Schema.brand("RoutineId"));
export type RoutineId = typeof RoutineId.Type;
export const RoutineRequestId = TrimmedNonEmptyString.pipe(Schema.brand("RoutineRequestId"));
export type RoutineRequestId = typeof RoutineRequestId.Type;
export const RoutineOccurrenceKey = TrimmedNonEmptyString.pipe(
  Schema.brand("RoutineOccurrenceKey"),
);
export type RoutineOccurrenceKey = typeof RoutineOccurrenceKey.Type;
const LocalTime = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/));
const Weekday = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 6 }));
export const ScheduleTrigger = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("weekdays"),
    time: LocalTime,
    timezone: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("daily"),
    time: LocalTime,
    timezone: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("weekly"),
    time: LocalTime,
    weekday: Weekday,
    timezone: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("cron"),
    expression: TrimmedNonEmptyString,
    timezone: TrimmedNonEmptyString,
  }),
]);
export type ScheduleTrigger = typeof ScheduleTrigger.Type;
export const RoutineWorkspace = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("worktree"),
    baseBranch: TrimmedNonEmptyString,
    startFromOrigin: Schema.Boolean,
    runSetupScript: Schema.Boolean,
  }),
  Schema.Struct({ kind: Schema.Literal("shared"), directory: TrimmedNonEmptyString }),
]);
export const RoutineDraft = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  instruction: TrimmedNonEmptyString.check(Schema.isMaxLength(100_000)),
  projectId: ProjectId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  workspace: RoutineWorkspace,
  trigger: ScheduleTrigger,
});
export type RoutineDraft = typeof RoutineDraft.Type;
export const Routine = Schema.Struct({
  id: RoutineId,
  environmentId: EnvironmentId,
  revision: PositiveInt,
  configuration: RoutineDraft,
  state: Schema.Literals(["enabled", "paused", "deleted"]),
  nextDueAt: IsoDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Routine = typeof Routine.Type;
export const RoutineRunStatus = Schema.Literals([
  "queued",
  "starting",
  "running",
  "waiting-for-approval",
  "succeeded",
  "failed",
  "interrupted",
  "needs-attention",
  "skipped",
  "blocked",
]);
export type RoutineRunStatus = typeof RoutineRunStatus.Type;
export const RoutineRunStage = Schema.Literals([
  "admitted",
  "thread-created",
  "prompt-accepted",
  "submitting",
  "provider-bound",
  "terminal",
]);
export type RoutineRunStage = typeof RoutineRunStage.Type;
export const RoutineRun = Schema.Struct({
  id: RoutineRunId,
  routineId: RoutineId,
  environmentId: EnvironmentId,
  revision: PositiveInt,
  configuration: RoutineDraft,
  occurrenceKey: Schema.String,
  source: Schema.Literals(["schedule", "test", "downtime"]),
  threadId: ThreadId,
  messageId: MessageId,
  commandId: CommandId,
  conversation: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("unconfirmed") }),
    Schema.Struct({ kind: Schema.Literal("confirmed"), threadId: ThreadId }),
  ]),
  status: RoutineRunStatus,
  stage: RoutineRunStage,
  turnId: Schema.NullOr(TurnId),
  detail: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RoutineRun = typeof RoutineRun.Type;
export class RoutineError extends Schema.TaggedError<RoutineError>()("RoutineError", {
  code: Schema.Literals([
    "validation",
    "conflict",
    "not-found",
    "blocked",
    "lost-fence",
    "persistence",
  ]),
  message: Schema.String,
}) {}
export const RoutineSaveInput = Schema.Struct({
  id: RoutineId,
  expectedRevision: NonNegativeInt,
  configuration: RoutineDraft,
});
export const RoutineGetInput = Schema.Struct({ id: RoutineId });
export const RoutineChangeInput = Schema.Struct({
  id: RoutineId,
  expectedRevision: PositiveInt,
  action: Schema.Literals(["pause", "resume", "delete"]),
});
export const RoutineTestInput = Schema.Struct({
  id: RoutineId,
  expectedRevision: PositiveInt,
  requestId: RoutineRequestId,
});
export const RoutineHistoryInput = Schema.Struct({
  id: RoutineId,
  before: Schema.optional(Schema.String),
  limit: Schema.optional(PositiveInt),
});
export const RoutinePreviewInput = Schema.Struct({ trigger: ScheduleTrigger });
export const RoutinePreview = Schema.Struct({
  expression: Schema.String,
  dates: Schema.Array(IsoDateTime),
});
export const RoutineList = Schema.Array(Routine);
export const RoutineHistory = Schema.Struct({
  runs: Schema.Array(RoutineRun),
  nextCursor: Schema.NullOr(Schema.String),
});

export const RoutineSubscriptionEvent = Schema.Struct({
  kind: Schema.Literals(["snapshot", "changed"]),
  routines: Schema.Array(Routine),
  cursor: NonNegativeInt,
});
export type RoutineSubscriptionEvent = typeof RoutineSubscriptionEvent.Type;

export function previewRoutineSchedule(
  trigger: ScheduleTrigger,
  after: Date,
): typeof RoutinePreview.Type {
  const expression =
    trigger.kind === "cron"
      ? trigger.expression
      : (() => {
          const [hour, minute] = trigger.time.split(":");
          const day =
            trigger.kind === "weekdays"
              ? "1-5"
              : trigger.kind === "weekly"
                ? String(trigger.weekday)
                : "*";
          return `${Number(minute)} ${Number(hour)} * * ${day}`;
        })();
  try {
    if (expression.length > 256 || expression.trim().split(/\s+/).length !== 5)
      throw new Error("Use exactly five cron fields at minute granularity.");
    new Intl.DateTimeFormat("en", { timeZone: trigger.timezone }).format(after);
    const parsed = Result.getOrThrow(Cron.parse(expression, trigger.timezone));
    const dates: string[] = [];
    let cursor = after;
    for (let i = 0; i < 3; i++) {
      cursor = Cron.next(parsed, cursor);
      dates.push(cursor.toISOString());
    }
    return { expression, dates };
  } catch (cause) {
    throw new RoutineError({
      code: "validation",
      message: `Invalid schedule or timezone: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
}
