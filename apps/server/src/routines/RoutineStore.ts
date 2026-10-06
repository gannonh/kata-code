import * as NodeCrypto from "node:crypto";
import {
  CommandId,
  EVENT_ROUTINE_NEXT_DUE_AT,
  EnvironmentId,
  MessageId,
  Routine,
  RoutineChangeInput,
  RoutineConnection,
  RoutineConnectionId,
  RoutineDelivery,
  RoutineError,
  RoutineHistoryInput,
  type RoutineLinearMetadata,
  RoutineRun,
  RoutineRunId,
  RoutineSaveInput,
  RoutineSubscriptionEvent,
  RoutineTestInput,
  ThreadId,
  isScheduleTrigger,
  previewRoutineSchedule,
} from "@kata-sh/code-contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import {
  formatEventContext,
  triggerMatchesEvent,
  type GitHubRoutineEventSummary,
} from "./GitHubRoutineEvents.ts";
import {
  formatLinearEventContext,
  linearTriggerMatchesEvent,
  type LinearRoutineEventSummary,
} from "./LinearRoutineEvents.ts";

const decodeRoutine = Schema.decodeUnknownSync(Schema.fromJsonString(Routine));
const decodeRun = Schema.decodeUnknownSync(Schema.fromJsonString(RoutineRun));
const encodeRoutine = Schema.encodeSync(Schema.fromJsonString(Routine));
const encodeRun = Schema.encodeSync(Schema.fromJsonString(RoutineRun));
const decodeConnection = Schema.decodeUnknownSync(Schema.fromJsonString(RoutineConnection));
const encodeConnection = Schema.encodeSync(Schema.fromJsonString(RoutineConnection));
const encodeDelivery = Schema.encodeSync(Schema.fromJsonString(RoutineDelivery));
/** Signed-content digests are only suppressed inside this window. */
const DELIVERY_DIGEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Rejected deliveries arrive before signature verification, so bound what is stored. */
export const MAX_DELIVERY_HEADER_LENGTH = 128;
export const REJECTED_DELIVERY_CHANGE_INTERVAL_MS = 10_000;
const boundedDeliveryHeader = (value: string) => value.slice(0, MAX_DELIVERY_HEADER_LENGTH);
export type RoutineEventSummary = GitHubRoutineEventSummary | LinearRoutineEventSummary;
export interface RoutineEventAdmissionInput {
  readonly connectionId: RoutineConnectionId;
  readonly deliveryId: string;
  /** Hex digest of the raw signed body. */
  readonly digest: string;
  readonly eventName: string;
  /** Provider resource id declared by the payload; checked against the connection. */
  readonly providerResourceId: string | number | null;
  /** Null when the event or action is not one routines can run on. */
  readonly summary: RoutineEventSummary | null;
  /** Named diagnostic for a summary-less delivery, when the provider supplies one. */
  readonly ignoredDetail?: string;
  readonly now: number;
}
export type RoutineEventRejectionReason = "disabled" | "wrong-resource";
export interface RoutineEventRecorded {
  readonly status: "accepted" | "ignored" | "duplicate";
  readonly runs: ReadonlyArray<RoutineRun>;
}
export interface RoutineEventRejected {
  readonly status: "rejected";
  readonly reason: RoutineEventRejectionReason;
  readonly detail: string;
  readonly runs: ReadonlyArray<RoutineRun>;
}
export type RoutineEventAdmission = RoutineEventRecorded | RoutineEventRejected;
export type RoutineClaim = {
  readonly run: RoutineRun;
  readonly owner: string;
  readonly generation: number;
};
export type RoutineCursor = { readonly admittedAt: number; readonly id: string };
export interface RoutineSaveOptions {
  /** Current Linear resources fetched before the authoritative save transaction. */
  readonly linearMetadata?: RoutineLinearMetadata;
}
const failure = (code: RoutineError["code"], message: string) =>
  new RoutineError({ code, message });
const isRoutineError = Schema.is(RoutineError);
const persistenceError = (error: unknown) =>
  isRoutineError(error) ? error : failure("persistence", String(error));
const isoAt = (now: number) => DateTime.formatIso(DateTime.makeUnsafe(now));
const SCHEDULER_LEASE_MS = 10_000;
const encodeCursor = ({ admittedAt, id }: RoutineCursor) =>
  `${admittedAt}.${encodeURIComponent(id)}`;
const decodeCursor = (value: string): RoutineCursor => {
  const separator = value.indexOf(".");
  if (separator <= 0 || separator === value.length - 1)
    throw failure("validation", "Invalid routine history cursor.");
  const admittedAt = Number(value.slice(0, separator));
  const id = decodeURIComponent(value.slice(separator + 1));
  if (!Number.isSafeInteger(admittedAt) || admittedAt < 0 || id.length === 0)
    throw failure("validation", "Invalid routine history cursor.");
  return { admittedAt, id };
};

export const makeRoutineStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // The first statement takes SQLite's writer lock before any authoritative reads.
  const transaction = <A, E, R>(body: Effect.Effect<A, E, R>) =>
    sql
      .withTransaction(
        sql`UPDATE routine_scheduler SET id = id WHERE id = 1`.pipe(Effect.andThen(body)),
      )
      .pipe(Effect.mapError(persistenceError));
  /** The database row's environment is authoritative; a copied record may still name its source. */
  const withOwningEnvironment = <A extends { readonly environmentId: EnvironmentId }>(
    environmentId: EnvironmentId,
    record: A,
  ): A => ({ ...record, environmentId });
  const readRoutine = (environmentId: EnvironmentId, id: string) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        record: string;
      }>`SELECT record FROM routines WHERE id = ${id} AND environment_id = ${environmentId}`;
      if (!rows[0]) return yield* failure("not-found", "Routine no longer exists.");
      return yield* Effect.try({
        try: () => withOwningEnvironment(environmentId, decodeRoutine(rows[0]!.record)),
        catch: persistenceError,
      });
    });
  const writeRoutine = (
    routine: Routine,
  ) => sql`INSERT INTO routines (id, environment_id, revision, state, next_due_at, trigger_kind, record)
    VALUES (${routine.id}, ${routine.environmentId}, ${routine.revision}, ${routine.state}, ${routine.nextDueAt}, ${triggerKind(routine)}, ${encodeRoutine(routine)})
    ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, state=excluded.state, next_due_at=excluded.next_due_at, trigger_kind=excluded.trigger_kind, record=excluded.record`;
  const triggerKind = (routine: Routine) =>
    isScheduleTrigger(routine.configuration.trigger)
      ? "schedule"
      : routine.configuration.trigger.kind;
  const recordChange = (
    environmentId: EnvironmentId,
    kind: RoutineSubscriptionEvent["kind"] = "changed",
  ) => sql`INSERT INTO routine_changes (environment_id, kind) VALUES (${environmentId}, ${kind})`;
  const writeRun = (run: RoutineRun, active: boolean) =>
    sql`UPDATE routine_runs SET record=${encodeRun(run)}, stage=${run.stage}, active=${active ? 1 : 0} WHERE id=${run.id}`.pipe(
      Effect.andThen(recordChange(run.environmentId)),
    );
  const nextDue = (configuration: Routine["configuration"], now: number) => {
    const trigger = configuration.trigger;
    if (!isScheduleTrigger(trigger)) return Effect.succeed(EVENT_ROUTINE_NEXT_DUE_AT);
    return Effect.try({
      try: () =>
        previewRoutineSchedule(trigger, DateTime.toDateUtc(DateTime.makeUnsafe(now))).dates[0]!,
      catch: persistenceError,
    });
  };
  const connectionOfRow = (row: {
    readonly record: string;
    readonly environmentId: EnvironmentId;
  }) => withOwningEnvironment(row.environmentId, decodeConnection(row.record));
  /** Callback lookup by id alone; the caller verifies the signature before trusting anything else. */
  const findConnection = (id: string) =>
    sql<{
      record: string;
      environmentId: EnvironmentId;
    }>`SELECT record, environment_id AS environmentId FROM routine_connections WHERE id = ${id}`.pipe(
      Effect.flatMap((rows) =>
        rows[0]
          ? Effect.try({ try: () => connectionOfRow(rows[0]!), catch: persistenceError })
          : Effect.succeed<RoutineConnection | null>(null),
      ),
      Effect.mapError(persistenceError),
    );
  const readConnection = (id: string) =>
    findConnection(id).pipe(
      Effect.flatMap((connection) =>
        connection === null
          ? Effect.fail(failure("not-found", "Connection no longer exists."))
          : Effect.succeed(connection),
      ),
    );
  const writeConnection = (
    connection: RoutineConnection,
  ) => sql`INSERT INTO routine_connections (id, environment_id, status, record)
    VALUES (${connection.id}, ${connection.environmentId}, ${connection.status}, ${encodeConnection(connection)})
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, record=excluded.record`;
  /** An event trigger must name a live connection of this environment for the same resource. */
  const checkTrigger = (
    environmentId: EnvironmentId,
    configuration: Routine["configuration"],
    options: RoutineSaveOptions,
  ) =>
    Effect.gen(function* () {
      const trigger = configuration.trigger;
      if (isScheduleTrigger(trigger)) return;
      const rows = yield* sql<{
        record: string;
      }>`SELECT record FROM routine_connections WHERE id = ${trigger.connectionId} AND environment_id = ${environmentId}`;
      const connection = rows[0] ? decodeConnection(rows[0].record) : undefined;
      if (trigger.kind === "github") {
        if (!connection || connection.provider !== "github")
          return yield* failure("validation", "Connect the GitHub repository before saving.");
        if (connection.status === "disabled")
          return yield* failure("validation", "This GitHub connection is disabled.");
        if (connection.repositoryId !== trigger.repositoryId)
          return yield* failure(
            "validation",
            "The selected repository does not match the connection.",
          );
        return;
      }
      if (!connection || connection.provider !== "linear")
        return yield* failure("validation", "Connect the Linear workspace before saving.");
      if (connection.status === "disabled")
        return yield* failure("validation", "This Linear connection is disabled.");
      if (connection.workspaceId !== trigger.workspaceId)
        return yield* failure(
          "validation",
          "The selected workspace does not match the connection.",
        );
      const hasResourceFilter =
        trigger.teamId !== undefined ||
        trigger.projectId !== undefined ||
        trigger.event === "status_changed" ||
        trigger.event === "label_added";
      if (!hasResourceFilter) return;
      const metadata = options.linearMetadata;
      if (metadata === undefined)
        return yield* failure(
          "validation",
          "Refresh Linear workspace metadata before saving resource filters.",
        );
      const allowedTeamIds = new Set(
        connection.allTeams
          ? metadata.teams.filter((team) => team.visibility === "public").map((team) => team.id)
          : connection.teamIds,
      );
      if (trigger.teamId !== undefined && !allowedTeamIds.has(trigger.teamId))
        return yield* failure("validation", "Choose a team inside this connection's scope.");
      let selectedProjectTeamIds: ReadonlySet<string> | null = null;
      if (trigger.projectId !== undefined) {
        const project = metadata.projects.find((candidate) => candidate.id === trigger.projectId);
        if (!project || !project.teamIds.some((teamId) => allowedTeamIds.has(teamId)))
          return yield* failure("validation", "Choose a project inside this connection's scope.");
        selectedProjectTeamIds = new Set(project.teamIds);
        if (trigger.teamId !== undefined && !selectedProjectTeamIds.has(trigger.teamId))
          return yield* failure("validation", "Choose a project in the selected team.");
      }
      const selectedResourceTeamIds =
        trigger.teamId !== undefined
          ? new Set([trigger.teamId])
          : (selectedProjectTeamIds ?? allowedTeamIds);
      if (trigger.event === "status_changed") {
        const state = metadata.states.find((candidate) => candidate.id === trigger.stateId);
        if (
          !state ||
          !allowedTeamIds.has(state.teamId) ||
          !selectedResourceTeamIds.has(state.teamId)
        )
          return yield* failure("validation", "Choose a status inside this connection's scope.");
      }
      if (trigger.event === "label_added") {
        const label = metadata.labels.find((candidate) => candidate.id === trigger.labelId);
        if (
          !label ||
          (label.teamId !== null &&
            (!allowedTeamIds.has(label.teamId) || !selectedResourceTeamIds.has(label.teamId)))
        )
          return yield* failure("validation", "Choose a label inside this connection's scope.");
      }
    });
  const checkRevision = (routine: Routine, revision: number) =>
    routine.revision === revision
      ? Effect.void
      : Effect.fail(
          failure(
            "conflict",
            "This routine changed. Reload the saved version before saving again.",
          ),
        );
  const list = (environmentId: EnvironmentId) =>
    sql<{
      record: string;
    }>`SELECT record FROM routines WHERE environment_id=${environmentId} AND state <> 'deleted' ORDER BY id`.pipe(
      Effect.flatMap((rows) =>
        Effect.try({
          try: () =>
            rows.map((row) => withOwningEnvironment(environmentId, decodeRoutine(row.record))),
          catch: persistenceError,
        }),
      ),
      Effect.mapError(persistenceError),
    );
  const get = (environmentId: EnvironmentId, id: string) =>
    readRoutine(environmentId, id).pipe(
      Effect.filterOrFail(
        (routine) => routine.state !== "deleted",
        () => failure("not-found", "Routine no longer exists."),
      ),
      Effect.mapError(persistenceError),
    );
  const save = (
    environmentId: EnvironmentId,
    input: typeof RoutineSaveInput.Type,
    now: number,
    options: RoutineSaveOptions = {},
  ) =>
    transaction(
      Effect.gen(function* () {
        yield* checkTrigger(environmentId, input.configuration, options);
        const nextDueAt = yield* nextDue(input.configuration, now);
        const owners = yield* sql<{
          environmentId: EnvironmentId;
        }>`SELECT environment_id AS environmentId FROM routines WHERE id=${input.id}`;
        const owner = owners[0]?.environmentId;
        if (owner !== undefined && owner !== environmentId)
          return yield* failure("conflict", "This routine id belongs to another environment.");
        const rows = yield* sql<{
          record: string;
        }>`SELECT record FROM routines WHERE id=${input.id} AND environment_id=${environmentId}`;
        const previous = rows[0] ? decodeRoutine(rows[0].record) : undefined;
        if ((previous?.revision ?? 0) !== input.expectedRevision || previous?.state === "deleted")
          return yield* failure(
            "conflict",
            "This routine changed. Reload the saved version before saving again.",
          );
        const timestamp = isoAt(now);
        const routine: Routine = {
          id: input.id,
          environmentId,
          configuration: input.configuration,
          revision: input.expectedRevision + 1,
          state: previous?.state ?? "enabled",
          nextDueAt,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        yield* writeRoutine(routine);
        yield* recordChange(environmentId);
        return routine;
      }),
    );
  const cancelQueued = (id: string, now: number, reason: string) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        record: string;
      }>`SELECT record FROM routine_runs WHERE routine_id=${id} AND active=1 AND submission_consumed=0
        AND stage <> 'submitting'`;
      for (const row of rows) {
        const run = decodeRun(row.record);
        yield* writeRun(
          { ...run, stage: "terminal", status: "skipped", detail: reason, updatedAt: isoAt(now) },
          false,
        );
      }
    });
  const change = (
    environmentId: EnvironmentId,
    input: typeof RoutineChangeInput.Type,
    now: number,
  ) =>
    transaction(
      Effect.gen(function* () {
        const previous = yield* readRoutine(environmentId, input.id);
        yield* checkRevision(previous, input.expectedRevision);
        if (previous.state === "deleted")
          return yield* failure("not-found", "Routine was deleted.");
        const state =
          input.action === "pause" ? "paused" : input.action === "delete" ? "deleted" : "enabled";
        const routine: Routine = {
          ...previous,
          state,
          revision: previous.revision + 1,
          updatedAt: isoAt(now),
          nextDueAt:
            state === "enabled" ? yield* nextDue(previous.configuration, now) : previous.nextDueAt,
        };
        yield* writeRoutine(routine);
        if (state !== "enabled")
          yield* cancelQueued(
            routine.id,
            now,
            state === "paused"
              ? "Routine paused before submission."
              : "Routine deleted before submission.",
          );
        yield* recordChange(environmentId);
        return routine;
      }),
    );
  const insertRun = (
    routine: Routine,
    input: {
      readonly occurrenceKey: string;
      readonly source: RoutineRun["source"];
      readonly now: number;
      readonly skipReason?: string | undefined;
      readonly event?: Pick<RoutineRun, "sourceUrl" | "eventContext"> | undefined;
    },
  ) =>
    Effect.gen(function* () {
      const { occurrenceKey, now, source } = input;
      const skipReason = input.skipReason;
      const event = input.event;
      const existing = yield* sql<{
        record: string;
      }>`SELECT record FROM routine_runs WHERE routine_id=${routine.id} AND occurrence_key=${occurrenceKey}`;
      if (existing[0])
        return withOwningEnvironment(routine.environmentId, decodeRun(existing[0].record));
      const active =
        yield* sql`SELECT id FROM routine_runs WHERE routine_id=${routine.id} AND active=1`;
      const reason =
        skipReason ??
        (active.length ? "Previous run is active or waiting for attention." : undefined);
      const id = RoutineRunId.make(NodeCrypto.randomUUID());
      const timestamp = isoAt(now);
      const run: RoutineRun = {
        id,
        routineId: routine.id,
        environmentId: routine.environmentId,
        revision: routine.revision,
        configuration: routine.configuration,
        occurrenceKey,
        source,
        ...(event?.sourceUrl ? { sourceUrl: event.sourceUrl } : {}),
        ...(event?.eventContext ? { eventContext: event.eventContext } : {}),
        threadId: ThreadId.make(`routine-${id}`),
        messageId: MessageId.make(`routine-message-${id}`),
        commandId: CommandId.make(`routine-turn-${id}`),
        conversation: { kind: "unconfirmed" },
        status: reason ? "skipped" : "queued",
        stage: reason ? "terminal" : "admitted",
        turnId: null,
        detail: reason ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      yield* sql`INSERT INTO routine_runs (id,routine_id,occurrence_key,admitted_at,stage,active,thread_id,message_id,command_id,record)
      VALUES (${id},${routine.id},${occurrenceKey},${now},${run.stage},${reason ? 0 : 1},${run.threadId},${run.messageId},${run.commandId},${encodeRun(run)})`;
      yield* recordChange(routine.environmentId);
      return run;
    });
  const testRun = (
    environmentId: EnvironmentId,
    input: typeof RoutineTestInput.Type,
    now: number,
  ) =>
    transaction(
      Effect.gen(function* () {
        const previous = yield* sql<{
          record: string;
        }>`SELECT record FROM routine_runs WHERE routine_id=${input.id} AND occurrence_key=${`test:${input.requestId}`}`;
        if (previous[0]) {
          const run = decodeRun(previous[0].record);
          if (run.environmentId !== environmentId)
            return yield* failure("not-found", "Routine does not belong to this environment.");
          if (run.revision !== input.expectedRevision)
            return yield* failure(
              "conflict",
              "This request ID belongs to a different saved revision.",
            );
          return run;
        }
        const routine = yield* readRoutine(environmentId, input.id);
        yield* checkRevision(routine, input.expectedRevision);
        if (routine.state !== "enabled")
          return yield* failure("blocked", "Resume the routine before testing it.");
        return yield* insertRun(routine, {
          occurrenceKey: `test:${input.requestId}`,
          source: "test",
          now,
        });
      }),
    );
  const history = (environmentId: EnvironmentId, input: typeof RoutineHistoryInput.Type) =>
    Effect.gen(function* () {
      yield* readRoutine(environmentId, input.id);
      const limit = Math.min(input.limit ?? 20, 100);
      const cursor = input.before === undefined ? undefined : decodeCursor(input.before);
      const rows = cursor
        ? yield* sql<{
            record: string;
            admittedAt: number;
            id: string;
          }>`SELECT record, admitted_at AS admittedAt, id FROM routine_runs WHERE routine_id=${input.id}
          AND (admitted_at < ${cursor.admittedAt} OR (admitted_at = ${cursor.admittedAt} AND id < ${cursor.id}))
          ORDER BY admitted_at DESC, id DESC LIMIT ${limit + 1}`
        : yield* sql<{
            record: string;
            admittedAt: number;
            id: string;
          }>`SELECT record, admitted_at AS admittedAt, id FROM routine_runs WHERE routine_id=${input.id}
          ORDER BY admitted_at DESC, id DESC LIMIT ${limit + 1}`;
      const runs = rows
        .slice(0, limit)
        .map((row) => withOwningEnvironment(environmentId, decodeRun(row.record)));
      const last = rows.at(limit - 1);
      return {
        runs,
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({ admittedAt: last.admittedAt, id: last.id })
            : null,
      };
    }).pipe(Effect.mapError(persistenceError));
  const tick = (owner: string, now: number) =>
    transaction(
      Effect.gen(function* () {
        const knownWorker = yield* sql<{
          owner: string;
          started_at: number;
        }>`SELECT owner, started_at FROM routine_scheduler_workers WHERE owner=${owner}`;
        yield* sql`INSERT INTO routine_scheduler_workers(owner, started_at, last_seen_at)
      VALUES (${owner}, ${now}, ${now})
      ON CONFLICT(owner) DO UPDATE SET last_seen_at=excluded.last_seen_at`;
        const leaders = yield* sql<{
          owner: string | null;
          lease_until: number;
          observed_at: number;
        }>`SELECT owner, lease_until, observed_at FROM routine_scheduler WHERE id=1`;
        const leader = leaders[0]!;
        if (leader.owner !== owner && leader.lease_until > now) return;
        // A brand-new scheduler has no outage interval to account for. Once it
        // has observed a tick, a long gap is explicit downtime and due occurrences
        // are admitted as skipped records with an explanation.
        // A process that was already alive before an occurrence became due can
        // safely admit it after a leader handoff. A fresh worker that first
        // appears after the due instant must record that occurrence as downtime,
        // even when the lease gap is shorter than a wall-clock threshold.
        const workerStartedAt = knownWorker[0]?.started_at ?? now;
        yield* sql`UPDATE routine_scheduler SET owner=${owner}, generation=generation+CASE WHEN owner=${owner} THEN 0 ELSE 1 END,
      lease_until=${now + SCHEDULER_LEASE_MS}, observed_at=${Math.max(now, leader.observed_at)} WHERE id=1`;
        const nowIso = isoAt(now);
        const due = yield* sql<{
          record: string;
          environmentId: EnvironmentId;
        }>`SELECT record, environment_id AS environmentId FROM routines WHERE state='enabled' AND trigger_kind='schedule' AND next_due_at <= ${nowIso}`;
        for (const row of due) {
          const routine = withOwningEnvironment(row.environmentId, decodeRoutine(row.record));
          const downtime =
            leader.observed_at > 0 && workerStartedAt > Date.parse(routine.nextDueAt);
          yield* insertRun(routine, {
            occurrenceKey: `schedule:${routine.revision}:${routine.nextDueAt}`,
            source: downtime ? "downtime" : "schedule",
            now,
            skipReason: downtime
              ? `Server unavailable between ${routine.nextDueAt} and ${nowIso}; elapsed schedules were skipped.`
              : undefined,
          });
          yield* writeRoutine({
            ...routine,
            nextDueAt: yield* nextDue(routine.configuration, now),
          });
          yield* recordChange(routine.environmentId);
        }
      }),
    );
  const listConnections = (environmentId: EnvironmentId) =>
    sql<{
      record: string;
    }>`SELECT record FROM routine_connections WHERE environment_id=${environmentId} ORDER BY id`.pipe(
      Effect.flatMap((rows) =>
        Effect.try({
          try: () => rows.map((row) => connectionOfRow({ record: row.record, environmentId })),
          catch: persistenceError,
        }),
      ),
      Effect.mapError(persistenceError),
    );
  const getConnection = (environmentId: EnvironmentId, id: string) =>
    readConnection(id).pipe(
      Effect.filterOrFail(
        (connection) => connection.environmentId === environmentId,
        () => failure("not-found", "Connection no longer exists."),
      ),
      Effect.mapError(persistenceError),
    );
  const saveConnection = (connection: RoutineConnection) =>
    transaction(
      sql`INSERT INTO routine_connections (id, environment_id, status, record)
        VALUES (${connection.id}, ${connection.environmentId}, ${connection.status}, ${encodeConnection(connection)})`.pipe(
        Effect.andThen(recordChange(connection.environmentId)),
      ),
    );
  const patchConnection = (
    read: Effect.Effect<RoutineConnection, RoutineError>,
    patch: (connection: RoutineConnection) => RoutineConnection,
  ) =>
    transaction(
      Effect.gen(function* () {
        const next = patch(yield* read);
        yield* writeConnection(next);
        yield* recordChange(next.environmentId);
        return next;
      }),
    );
  const updateConnection = (
    environmentId: EnvironmentId,
    id: string,
    patch: (connection: RoutineConnection) => RoutineConnection,
  ) => patchConnection(getConnection(environmentId, id), patch);
  const rejectionChangeAt = new Map<string, number>();
  const recordRejectedDelivery = (
    connectionId: string,
    input: { readonly deliveryId: string; readonly event: string; readonly detail: string },
    now: number,
  ) =>
    transaction(
      Effect.gen(function* () {
        const connection = yield* readConnection(connectionId);
        const previous = connection.lastDelivery;
        const lastChangeAt = rejectionChangeAt.get(connectionId);
        yield* writeConnection({
          ...connection,
          rejectedCount: connection.rejectedCount + 1,
          lastDelivery: {
            deliveryId: boundedDeliveryHeader(input.deliveryId),
            event: boundedDeliveryHeader(input.event),
            status: "rejected",
            detail: input.detail,
            runId: null,
            receivedAt: isoAt(now),
          },
          updatedAt: isoAt(now),
        });
        // Unauthenticated callers reach this path, so change rows are coalesced
        // per connection; the rejected count stays exact. The window is anchored
        // to the last emitted change, not the last rejection, so a sustained
        // stream still refreshes subscribers once per interval.
        const coalesced =
          previous?.status === "rejected" &&
          lastChangeAt !== undefined &&
          now - lastChangeAt < REJECTED_DELIVERY_CHANGE_INTERVAL_MS;
        if (coalesced) return false;
        yield* recordChange(connection.environmentId);
        return true;
      }),
    ).pipe(
      Effect.tap((emitted) =>
        Effect.sync(() => {
          if (emitted) rejectionChangeAt.set(connectionId, now);
        }),
      ),
      Effect.asVoid,
    );
  /**
   * Owns the whole admission decision table for a known connection: disabled
   * connections and payloads for another repository are rejected, unsupported
   * events and unmatched repositories are ignored. The signed delivery and
   * every run it admits are recorded in one transaction, so a 2xx to the
   * provider always means the intent is durable. Runs reuse the
   * scheduled-routine admission path, including its active-slot short circuit.
   */
  const admitEvent = (
    input: RoutineEventAdmissionInput,
  ): Effect.Effect<RoutineEventAdmission, RoutineError> =>
    transaction(
      Effect.gen(function* () {
        const connection = yield* readConnection(input.connectionId);
        // Expire the window before checking replay identity, so an old digest
        // cannot suppress every later delivery and prevent its own pruning.
        yield* sql`DELETE FROM routine_deliveries WHERE connection_id=${connection.id}
          AND received_at < ${input.now - DELIVERY_DIGEST_WINDOW_MS}`;
        const duplicate = yield* sql<{
          delivery_id: string;
        }>`SELECT delivery_id FROM routine_deliveries WHERE connection_id=${connection.id}
          AND (delivery_id=${input.deliveryId} OR digest=${input.digest})`;
        if (duplicate[0]) return { status: "duplicate", runs: [] } satisfies RoutineEventRecorded;
        const runs: RoutineRun[] = [];
        let rejection: {
          readonly reason: RoutineEventRejectionReason;
          readonly detail: string;
        } | null = null;
        let detail: string | null = null;
        // Only GitHub defines a ping handshake; a Linear delivery cannot claim it.
        const ping = input.eventName === "ping" && connection.provider === "github";
        const wrongResource =
          connection.provider === "github"
            ? input.providerResourceId !== connection.repositoryId
            : input.providerResourceId !== connection.workspaceId;
        const outsideTeamScope =
          input.summary?.provider === "linear" &&
          connection.provider === "linear" &&
          connection.teamIds.length > 0 &&
          (input.summary.teamId === null || !connection.teamIds.includes(input.summary.teamId));
        if (connection.status === "disabled") {
          rejection = { reason: "disabled", detail: "Connection is disabled." };
        } else if (wrongResource) {
          rejection = {
            reason: "wrong-resource",
            detail:
              connection.provider === "github"
                ? "Delivery names a different repository."
                : "Delivery names a different workspace.",
          };
        } else if (ping) {
          detail = "GitHub ping received.";
        } else if (outsideTeamScope) {
          detail = "Delivery is outside this connection's team scope.";
        } else if (input.summary === null) {
          detail = input.ignoredDetail ?? `Unsupported event ${input.eventName}.`;
        } else {
          const summary = input.summary;
          const context =
            summary.provider === "github"
              ? formatEventContext(summary)
              : formatLinearEventContext(summary);
          const candidates = yield* sql<{
            record: string;
          }>`SELECT record FROM routines WHERE environment_id=${connection.environmentId}
            AND state='enabled' AND trigger_kind=${summary.provider} ORDER BY id`;
          for (const row of candidates) {
            const routine = withOwningEnvironment(
              connection.environmentId,
              decodeRoutine(row.record),
            );
            const trigger = routine.configuration.trigger;
            if (isScheduleTrigger(trigger) || trigger.connectionId !== connection.id) continue;
            const matched =
              summary.provider === "github"
                ? trigger.kind === "github" && triggerMatchesEvent(trigger, summary)
                : trigger.kind === "linear" && linearTriggerMatchesEvent(trigger, summary);
            if (!matched) continue;
            runs.push(
              yield* insertRun(routine, {
                occurrenceKey: `${summary.provider}:${input.deliveryId}`,
                source: summary.provider,
                now: input.now,
                event: { sourceUrl: summary.url || undefined, eventContext: context },
              }),
            );
          }
          if (runs.length === 0) detail = "No enabled routine matched this event.";
        }
        const status = rejection ? "rejected" : ping || runs.length > 0 ? "accepted" : "ignored";
        const delivery: RoutineDelivery = {
          deliveryId: input.deliveryId,
          event: input.eventName,
          status,
          detail: rejection?.detail ?? detail,
          runId: runs[0]?.id ?? null,
          receivedAt: isoAt(input.now),
        };
        yield* sql`INSERT INTO routine_deliveries (connection_id, delivery_id, digest, status, run_id, received_at, record)
          VALUES (${connection.id}, ${delivery.deliveryId}, ${input.digest}, ${status}, ${delivery.runId}, ${input.now}, ${encodeDelivery(delivery)})`;
        // Linear has no ping event: a valid delivery of any outcome confirms the
        // webhook works. GitHub keeps its explicit ping handshake.
        const verified =
          connection.status === "pending" &&
          (connection.provider === "github" ? ping && rejection === null : status !== "rejected");
        yield* writeConnection({
          ...connection,
          status: verified ? "verified" : connection.status,
          acceptedCount: connection.acceptedCount + (status === "accepted" ? 1 : 0),
          ignoredCount: connection.ignoredCount + (status === "ignored" ? 1 : 0),
          rejectedCount: connection.rejectedCount + (rejection ? 1 : 0),
          lastDelivery: delivery,
          updatedAt: isoAt(input.now),
        });
        yield* recordChange(connection.environmentId);
        if (rejection !== null) {
          return {
            status: "rejected",
            reason: rejection.reason,
            detail: rejection.detail,
            runs: [],
          } satisfies RoutineEventRejected;
        }
        return {
          status: ping || runs.length > 0 ? "accepted" : "ignored",
          runs,
        } satisfies RoutineEventRecorded;
      }),
    );
  const claim = (owner: string, now: number) =>
    transaction(
      Effect.gen(function* () {
        const leaders = yield* sql<{
          owner: string | null;
          lease_until: number;
        }>`SELECT owner, lease_until FROM routine_scheduler WHERE id=1`;
        const leader = leaders[0];
        if (leader && leader.owner !== owner && leader.lease_until > now) return null;
        const rows = yield* sql<{
          record: string;
          generation: number;
        }>`UPDATE routine_runs SET owner=${owner}, generation=generation+1, lease_until=${now + 30_000}
      WHERE id=(SELECT id FROM routine_runs WHERE active=1 AND submission_consumed=0 AND lease_until<=${now} ORDER BY id LIMIT 1)
      RETURNING record,generation`;
        return rows[0]
          ? {
              run: decodeRun(rows[0].record),
              owner,
              generation: rows[0].generation,
            }
          : null;
      }),
    );
  const lostPreparation = () =>
    failure("lost-fence", "Routine preparation ownership expired or was canceled.");
  // Reclaims only match unlaunched runs, so a launched run keeps the owner and
  // generation that launched it. That claim has handed the run to the
  // orchestration observer; every other mismatch is a lost fence.
  const preparationLease = (claim: RoutineClaim, now: number) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        leaseUntil: number;
        submissionConsumed: number;
        active: number;
      }>`SELECT lease_until AS leaseUntil, submission_consumed AS submissionConsumed, active FROM routine_runs
      WHERE id=${claim.run.id} AND owner=${claim.owner} AND generation=${claim.generation}`;
      const row = rows[0];
      if (row?.submissionConsumed === 1) return "handed-off" as const;
      if (row?.active === 1 && row.leaseUntil > now) return "held" as const;
      return yield* lostPreparation();
    });
  const assertClaim = (claim: RoutineClaim, now: number) =>
    preparationLease(claim, now).pipe(
      Effect.flatMap((lease) => (lease === "held" ? Effect.void : lostPreparation())),
    );
  const renew = (claim: RoutineClaim, now: number) =>
    transaction(
      Effect.gen(function* () {
        const lease = yield* preparationLease(claim, now);
        if (lease === "held") {
          yield* sql`UPDATE routine_runs SET lease_until=${now + 30_000} WHERE id=${claim.run.id}`;
        }
        return lease;
      }),
    );
  const updatePreparation = (
    claim: RoutineClaim,
    patch: Pick<RoutineRun, "status" | "stage" | "detail"> &
      Partial<Pick<RoutineRun, "conversation">>,
    now: number,
  ) =>
    transaction(
      Effect.gen(function* () {
        // After handoff the orchestration observer owns the run. A late
        // dispatcher failure must not overwrite a launched run.
        if ((yield* preparationLease(claim, now)) === "handed-off") return;
        // Re-read the current record so this update cannot erase fields another
        // transaction wrote while the dispatcher was working.
        const rows = yield* sql<{
          record: string;
        }>`SELECT record FROM routine_runs WHERE id=${claim.run.id}`;
        if (!rows[0]) return yield* failure("not-found", "Routine run no longer exists.");
        const current = decodeRun(rows[0].record);
        yield* writeRun(
          { ...current, ...patch, updatedAt: isoAt(now) },
          patch.stage !== "terminal",
        );
      }),
    );
  /**
   * Records the launch intent before the orchestration launch. A paused or
   * deleted routine no longer cancels the run after this point: the launch is
   * idempotent, so a reclaimed run completes it instead of guessing whether the
   * first attempt reached orchestration.
   */
  const beginLaunch = (claim: RoutineClaim, now: number) =>
    transaction(
      Effect.gen(function* () {
        yield* assertClaim(claim, now);
        const rows = yield* sql<{
          record: string;
        }>`SELECT record FROM routine_runs WHERE id=${claim.run.id}`;
        if (!rows[0]) return yield* failure("not-found", "Routine run no longer exists.");
        const current = decodeRun(rows[0].record);
        if (current.stage === "submitting") return;
        const routine = yield* readRoutine(claim.run.environmentId, claim.run.routineId);
        if (routine.state !== "enabled")
          return yield* failure("blocked", "Routine is no longer enabled.");
        yield* writeRun(
          { ...current, stage: "submitting", status: "starting", updatedAt: isoAt(now) },
          true,
        );
      }),
    );
  /** Hands the run to orchestration once the launch accepted its thread and message. */
  const markLaunched = (claim: RoutineClaim, now: number) =>
    transaction(
      Effect.gen(function* () {
        yield* assertClaim(claim, now);
        const rows = yield* sql<{
          record: string;
        }>`UPDATE routine_runs SET submission_consumed=1 WHERE id=${claim.run.id} AND submission_consumed=0 RETURNING record`;
        if (!rows[0]) return yield* lostPreparation();
        const current = decodeRun(rows[0].record);
        yield* writeRun(
          {
            ...current,
            stage: "prompt-accepted",
            status: "starting",
            detail: null,
            conversation: { kind: "confirmed", threadId: current.threadId },
            updatedAt: isoAt(now),
          },
          true,
        );
      }),
    );
  /** Launched runs whose orchestration outcome is still open, with their event cursor. */
  const launchedRuns = () =>
    sql<{
      record: string;
      eventCursor: number;
    }>`SELECT record, event_cursor AS eventCursor FROM routine_runs
      WHERE active=1 AND submission_consumed=1 ORDER BY admitted_at ASC, id ASC`.pipe(
      Effect.map((rows) =>
        rows.map((row) => ({ run: decodeRun(row.record), eventCursor: row.eventCursor })),
      ),
      Effect.mapError(persistenceError),
    );
  /**
   * Applies observed orchestration progress and advances the run's event
   * cursor. The cursor is compared first, so two observers reading the same
   * range cannot apply an older fold over a newer one.
   */
  const recordOrchestrationProgress = (
    input: {
      readonly runId: RoutineRunId;
      readonly fromCursor: number;
      readonly toCursor: number;
      readonly progress: Pick<RoutineRun, "status" | "stage" | "detail"> | null;
    },
    now: number,
  ) =>
    transaction(
      Effect.gen(function* () {
        const rows = yield* sql<{
          record: string;
        }>`UPDATE routine_runs SET event_cursor=${input.toCursor}
      WHERE id=${input.runId} AND event_cursor=${input.fromCursor} AND active=1 AND submission_consumed=1
      RETURNING record`;
        if (!rows[0]) return false;
        const current = decodeRun(rows[0].record);
        const progress = input.progress;
        if (
          progress === null ||
          (progress.status === current.status &&
            progress.stage === current.stage &&
            progress.detail === current.detail)
        )
          return false;
        yield* writeRun(
          { ...current, ...progress, updatedAt: isoAt(now) },
          progress.stage !== "terminal",
        );
        return true;
      }),
    );
  const subscribe = (environmentId: EnvironmentId) =>
    Effect.gen(function* () {
      // Read the high-water mark before the snapshot. Any write that races the
      // snapshot receives a larger durable cursor and is picked up by polling,
      // including writes made by another server process.
      const cursorRows = yield* sql<{
        cursor: number | null;
      }>`SELECT MAX(cursor) AS cursor FROM routine_changes WHERE environment_id=${environmentId}`;
      const cursor = cursorRows[0]?.cursor ?? 0;
      const routines = yield* list(environmentId);
      const cursorRef = yield* Ref.make(cursor);
      const poll = Effect.gen(function* () {
        const after = yield* Ref.get(cursorRef);
        const rows = yield* sql<{
          cursor: number;
          kind: RoutineSubscriptionEvent["kind"];
        }>`SELECT cursor, kind FROM routine_changes
        WHERE environment_id=${environmentId} AND cursor > ${after} ORDER BY cursor ASC LIMIT 100`;
        if (rows.length === 0) return [] as const;
        const last = rows[rows.length - 1]!;
        yield* Ref.set(cursorRef, last.cursor);
        const nextRoutines = yield* list(environmentId);
        return [
          {
            kind: last.kind,
            routines: nextRoutines,
            cursor: last.cursor,
          } satisfies RoutineSubscriptionEvent,
        ] as const;
      });
      const stream = Stream.fromSchedule(Schedule.spaced("500 millis")).pipe(
        Stream.mapEffect(() => poll),
        Stream.flatMap(Stream.fromIterable),
        Stream.mapError(persistenceError),
      );
      return {
        latest: { kind: "snapshot", routines, cursor } satisfies RoutineSubscriptionEvent,
        changes: stream,
      };
    }).pipe(Effect.mapError(persistenceError));
  const activeRuns = () =>
    sql<{ record: string }>`SELECT record FROM routine_runs WHERE active=1`.pipe(
      Effect.map((rows) => rows.map((row) => decodeRun(row.record))),
      Effect.mapError(persistenceError),
    );
  return {
    list,
    get,
    save,
    change,
    testRun,
    history,
    subscribe,
    tick,
    claim,
    renew,
    beginLaunch,
    markLaunched,
    updatePreparation,
    activeRuns,
    launchedRuns,
    recordOrchestrationProgress,
    listConnections,
    getConnection,
    findConnection,
    saveConnection,
    updateConnection,
    recordRejectedDelivery,
    admitEvent,
  };
});
export class RoutineStore extends Context.Service<
  RoutineStore,
  Effect.Success<typeof makeRoutineStore>
>()("@kata-sh/code-cli/routines/RoutineStore") {}
export const RoutineStoreLive = Layer.effect(RoutineStore, makeRoutineStore);
