import { randomUUID } from "node:crypto";
import {
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  Routine,
  RoutineChangeInput,
  RoutineError,
  RoutineHistoryInput,
  RoutineList,
  RoutineProviderSubmission,
  RoutineRun,
  RoutineRunId,
  RoutineSaveInput,
  RoutineSubscriptionEvent,
  RoutineTestInput,
  ThreadId,
  TurnId,
  previewRoutineSchedule,
} from "@kata-sh/code-contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Stream from "effect/Stream";

const decodeRoutine = Schema.decodeUnknownSync(Schema.fromJsonString(Routine));
const decodeRun = Schema.decodeUnknownSync(Schema.fromJsonString(RoutineRun));
const encodeRoutine = Schema.encodeSync(Schema.fromJsonString(Routine));
const encodeRun = Schema.encodeSync(Schema.fromJsonString(RoutineRun));
export type RoutineClaim = {
  readonly run: RoutineRun;
  readonly owner: string;
  readonly generation: number;
  /** A durable marker prevents setup from being skipped after a worker crash. */
  readonly setupComplete: boolean;
};
export type RoutineCursor = { readonly admittedAt: number; readonly id: string };
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
  const readRoutine = (id: string) =>
    Effect.gen(function* () {
      const rows = yield* sql<{ record: string }>`SELECT record FROM routines WHERE id = ${id}`;
      if (!rows[0]) return yield* failure("not-found", "Routine no longer exists.");
      return yield* Effect.try({
        try: () => decodeRoutine(rows[0]!.record),
        catch: persistenceError,
      });
    });
  const writeRoutine = (
    routine: Routine,
  ) => sql`INSERT INTO routines (id, environment_id, revision, state, next_due_at, record)
    VALUES (${routine.id}, ${routine.environmentId}, ${routine.revision}, ${routine.state}, ${routine.nextDueAt}, ${encodeRoutine(routine)})
    ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, state=excluded.state, next_due_at=excluded.next_due_at, record=excluded.record`;
  const recordChange = (
    environmentId: EnvironmentId,
    kind: RoutineSubscriptionEvent["kind"] = "changed",
  ) => sql`INSERT INTO routine_changes (environment_id, kind) VALUES (${environmentId}, ${kind})`;
  const writeRun = (run: RoutineRun, active: boolean) =>
    sql`UPDATE routine_runs SET record=${encodeRun(run)}, stage=${run.stage}, active=${active ? 1 : 0} WHERE id=${run.id}`.pipe(
      Effect.andThen(recordChange(run.environmentId)),
    );
  const nextDue = (configuration: Routine["configuration"], now: number) =>
    Effect.try({
      try: () =>
        previewRoutineSchedule(configuration.trigger, DateTime.toDateUtc(DateTime.makeUnsafe(now)))
          .dates[0]!,
      catch: persistenceError,
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
          try: () => rows.map((row) => decodeRoutine(row.record)),
          catch: persistenceError,
        }),
      ),
      Effect.mapError(persistenceError),
    );
  const get = (environmentId: EnvironmentId, id: string) =>
    readRoutine(id).pipe(
      Effect.filterOrFail(
        (routine) => routine.environmentId === environmentId && routine.state !== "deleted",
        () => failure("not-found", "Routine no longer exists."),
      ),
      Effect.mapError(persistenceError),
    );
  const save = (environmentId: EnvironmentId, input: typeof RoutineSaveInput.Type, now: number) =>
    transaction(
      Effect.gen(function* () {
        const nextDueAt = yield* nextDue(input.configuration, now);
        const rows = yield* sql<{
          record: string;
        }>`SELECT record FROM routines WHERE id=${input.id}`;
        const previous = rows[0] ? decodeRoutine(rows[0].record) : undefined;
        if (previous && previous.environmentId !== environmentId)
          return yield* failure("not-found", "Routine does not belong to this environment.");
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
      }>`SELECT record FROM routine_runs WHERE routine_id=${id} AND active=1 AND submission_consumed=0`;
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
        const previous = yield* readRoutine(input.id);
        if (previous.environmentId !== environmentId)
          return yield* failure("not-found", "Routine does not belong to this environment.");
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
    occurrenceKey: string,
    source: RoutineRun["source"],
    now: number,
    skipReason?: string,
  ) =>
    Effect.gen(function* () {
      const existing = yield* sql<{
        record: string;
      }>`SELECT record FROM routine_runs WHERE routine_id=${routine.id} AND occurrence_key=${occurrenceKey}`;
      if (existing[0]) return decodeRun(existing[0].record);
      const active =
        yield* sql`SELECT id FROM routine_runs WHERE routine_id=${routine.id} AND active=1`;
      const reason =
        skipReason ??
        (active.length ? "Previous run is active or waiting for attention." : undefined);
      const id = RoutineRunId.make(randomUUID());
      const timestamp = isoAt(now);
      const run: RoutineRun = {
        id,
        routineId: routine.id,
        environmentId: routine.environmentId,
        revision: routine.revision,
        configuration: routine.configuration,
        occurrenceKey,
        source,
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
        const routine = yield* readRoutine(input.id);
        if (routine.environmentId !== environmentId)
          return yield* failure("not-found", "Routine does not belong to this environment.");
        yield* checkRevision(routine, input.expectedRevision);
        if (routine.state !== "enabled")
          return yield* failure("blocked", "Resume the routine before testing it.");
        return yield* insertRun(routine, `test:${input.requestId}`, "test", now);
      }),
    );
  const history = (environmentId: EnvironmentId, input: typeof RoutineHistoryInput.Type) =>
    Effect.gen(function* () {
      const routine = yield* readRoutine(input.id);
      if (routine.environmentId !== environmentId)
        return yield* failure("not-found", "Routine does not belong to this environment.");
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
      const runs = rows.slice(0, limit).map((row) => decodeRun(row.record));
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
        }>`SELECT record FROM routines WHERE state='enabled' AND next_due_at <= ${nowIso}`;
        for (const row of due) {
          const routine = decodeRoutine(row.record);
          const downtime =
            leader.observed_at > 0 && workerStartedAt > Date.parse(routine.nextDueAt);
          yield* insertRun(
            routine,
            `schedule:${routine.revision}:${routine.nextDueAt}`,
            downtime ? "downtime" : "schedule",
            now,
            downtime
              ? `Server unavailable between ${routine.nextDueAt} and ${nowIso}; elapsed schedules were skipped.`
              : undefined,
          );
          yield* writeRoutine({
            ...routine,
            nextDueAt: yield* nextDue(routine.configuration, now),
          });
          yield* recordChange(routine.environmentId);
        }
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
          intentEvent: string | null;
        }>`UPDATE routine_runs SET owner=${owner}, generation=generation+1, lease_until=${now + 30_000}
      WHERE id=(SELECT id FROM routine_runs WHERE active=1 AND submission_consumed=0 AND lease_until<=${now} ORDER BY id LIMIT 1)
      RETURNING record,generation,intent_event AS intentEvent`;
        return rows[0]
          ? {
              run: decodeRun(rows[0].record),
              owner,
              generation: rows[0].generation,
              setupComplete: rows[0].intentEvent === "setup-complete",
            }
          : null;
      }),
    );
  const assertClaim = (claim: RoutineClaim, now: number) =>
    Effect.gen(function* () {
      const rows =
        yield* sql`SELECT id FROM routine_runs WHERE id=${claim.run.id} AND owner=${claim.owner} AND generation=${claim.generation}
      AND lease_until>${now} AND submission_consumed=0 AND active=1`;
      if (!rows.length)
        return yield* failure(
          "lost-fence",
          "Routine preparation ownership expired or was canceled.",
        );
    });
  const renew = (claim: RoutineClaim, now: number) =>
    transaction(
      Effect.gen(function* () {
        yield* assertClaim(claim, now);
        yield* sql`UPDATE routine_runs SET lease_until=${now + 30_000} WHERE id=${claim.run.id}`;
      }),
    );
  const consumeSubmission = (claim: RoutineClaim, now: number) =>
    transaction(
      Effect.gen(function* () {
        yield* assertClaim(claim, now);
        const routine = yield* readRoutine(claim.run.routineId);
        if (routine.state !== "enabled")
          return yield* failure("blocked", "Routine is no longer enabled.");
        const rows = yield* sql<{
          record: string;
        }>`UPDATE routine_runs SET submission_consumed=1 WHERE id=${claim.run.id} AND submission_consumed=0 RETURNING record`;
        if (!rows[0])
          return yield* failure("lost-fence", "Submission permission was already consumed.");
        const run = decodeRun(rows[0].record);
        yield* writeRun(
          { ...run, stage: "submitting", status: "starting", updatedAt: isoAt(now) },
          true,
        );
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
        yield* assertClaim(claim, now);
        // A dispatcher may spend time preparing a workspace while another
        // transaction records a thread or command receipt. Re-read the current
        // record so this progress update cannot erase those durable fields.
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
  const markSetupComplete = (claim: RoutineClaim, now: number) =>
    transaction(
      Effect.gen(function* () {
        yield* assertClaim(claim, now);
        yield* sql`UPDATE routine_runs SET intent_event='setup-complete' WHERE id=${claim.run.id}`;
      }),
    );
  const submissionClaim = (submission: RoutineProviderSubmission) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        record: string;
      }>`SELECT record FROM routine_runs WHERE id=${submission.runId}
      AND owner=${submission.owner} AND generation=${submission.generation}
      AND thread_id=${submission.threadId} AND message_id=${submission.messageId} AND command_id=${submission.commandId}`;
      if (!rows[0])
        return yield* failure("lost-fence", "Routine submission ownership is no longer current.");
      return {
        run: decodeRun(rows[0].record),
        owner: submission.owner,
        generation: submission.generation,
        setupComplete: false,
      } satisfies RoutineClaim;
    }).pipe(Effect.mapError(persistenceError));
  const consumeSubmissionForProvider = (submission: RoutineProviderSubmission, now: number) =>
    submissionClaim(submission).pipe(Effect.flatMap((claim) => consumeSubmission(claim, now)));
  const beginSessionPreparation = (submission: RoutineProviderSubmission) =>
    transaction(
      Effect.gen(function* () {
        const marker = `session-preparing:${submission.generation}`;
        const rows = yield* sql<{
          record: string;
        }>`UPDATE routine_runs SET intent_event=${marker}
      WHERE id=${submission.runId} AND owner=${submission.owner} AND generation=${submission.generation}
      AND thread_id=${submission.threadId} AND message_id=${submission.messageId} AND command_id=${submission.commandId}
      AND submission_consumed=0 AND active=1
      AND (intent_event IS NULL OR intent_event='setup-complete' OR (
        intent_event LIKE 'session-preparing:%' AND intent_event != ${marker}
      ))
      RETURNING record`;
        if (!rows[0]) return false;
        const run = decodeRun(rows[0].record);
        return (
          run.stage === "admitted" ||
          run.stage === "thread-created" ||
          run.stage === "prompt-accepted"
        );
      }),
    );
  const settleOnSessionExit = (
    input: {
      readonly threadId: ThreadId;
      readonly detail?: string | null | undefined;
    },
    now: number,
  ) =>
    transaction(
      Effect.gen(function* () {
        const rows = yield* sql<{ record: string }>`SELECT record FROM routine_runs
      WHERE thread_id=${input.threadId} AND active=1 AND submission_consumed=1
      ORDER BY admitted_at DESC, id DESC`;
        const current = rows
          .map((row) => decodeRun(row.record))
          .find((run) => run.stage !== "terminal");
        if (!current) return false;
        if (current.stage === "submitting" || current.turnId === null) {
          yield* writeRun(
            {
              ...current,
              status: "needs-attention",
              detail:
                input.detail ?? "The provider session exited before this routine turn was bound.",
              updatedAt: isoAt(now),
            },
            true,
          );
          return true;
        }
        yield* writeRun(
          {
            ...current,
            stage: "terminal",
            status: "interrupted",
            detail:
              input.detail ?? "The provider session exited before the routine turn completed.",
            updatedAt: isoAt(now),
          },
          false,
        );
        return true;
      }),
    );
  const bindProviderTurn = (submission: RoutineProviderSubmission, turnId: string, now: number) =>
    transaction(
      Effect.gen(function* () {
        const rows = yield* sql<{
          record: string;
        }>`SELECT record FROM routine_runs WHERE id=${submission.runId}
      AND owner=${submission.owner} AND generation=${submission.generation}
      AND thread_id=${submission.threadId} AND message_id=${submission.messageId} AND command_id=${submission.commandId}
      AND submission_consumed=1`;
        if (!rows[0])
          return yield* failure(
            "lost-fence",
            "Routine provider result belongs to an expired owner.",
          );
        const current = decodeRun(rows[0].record);
        // A provider can emit its first terminal event before sendTurn resolves.
        // Reconciliation then owns the durable terminal result and releases the
        // active slot. The late adapter return is an idempotent acknowledgement;
        // it must not resurrect that result or report a false fence loss.
        if (current.stage === "terminal") return;
        const terminalEvents = yield* sql<{
          status: string;
          detail: string | null;
          initialMessageId: string | null;
        }>`SELECT status, detail, initial_message_id AS initialMessageId FROM routine_provider_events
      WHERE thread_id=${submission.threadId} AND provider_turn_id=${turnId}`;
        const terminalEvent = terminalEvents[0];
        // The provider turn returned by this exact submission is the only
        // admissible correlation for the initial run. Drop terminal evidence for
        // other turns so a later manual conversation cannot be replayed against
        // this run after a restart.
        yield* sql`DELETE FROM routine_provider_events
      WHERE thread_id=${submission.threadId} AND provider_turn_id <> ${turnId}`;
        if (
          terminalEvent &&
          (terminalEvent.status === "succeeded" ||
            terminalEvent.status === "failed" ||
            terminalEvent.status === "interrupted") &&
          (terminalEvent.initialMessageId === null ||
            terminalEvent.initialMessageId === String(submission.messageId))
        ) {
          yield* sql`DELETE FROM routine_provider_events WHERE thread_id=${submission.threadId} AND provider_turn_id=${turnId}`;
          yield* writeRun(
            {
              ...current,
              stage: "terminal",
              status: terminalEvent.status,
              turnId: TurnId.make(turnId),
              detail: terminalEvent.detail,
              updatedAt: isoAt(now),
            },
            false,
          );
          return;
        }
        if (terminalEvent?.status === "waiting-for-approval") {
          yield* sql`DELETE FROM routine_provider_events WHERE thread_id=${submission.threadId} AND provider_turn_id=${turnId}`;
          yield* writeRun(
            {
              ...current,
              stage: "provider-bound",
              status: "waiting-for-approval",
              turnId: TurnId.make(turnId),
              detail: terminalEvent.detail,
              updatedAt: isoAt(now),
            },
            true,
          );
          return;
        }
        yield* writeRun(
          {
            ...current,
            stage: "provider-bound",
            status: "running",
            turnId: TurnId.make(turnId),
            updatedAt: isoAt(now),
          },
          true,
        );
      }),
    );
  const markNeedsAttention = (submission: RoutineProviderSubmission, detail: string, now: number) =>
    transaction(
      Effect.gen(function* () {
        const rows = yield* sql<{
          record: string;
        }>`SELECT record FROM routine_runs WHERE id=${submission.runId}
      AND owner=${submission.owner} AND generation=${submission.generation} AND submission_consumed=1 AND active=1`;
        if (!rows[0]) return;
        const current = decodeRun(rows[0].record);
        // The uncertainty state keeps the irreversible submission active. It must
        // remain eligible for exact provider evidence to settle it, while still
        // being excluded from preparation claims by submission_consumed=1.
        yield* writeRun(
          { ...current, status: "needs-attention", detail, updatedAt: isoAt(now) },
          true,
        );
      }),
    );
  const markBlockedBeforeSubmission = (
    submission: RoutineProviderSubmission,
    detail: string,
    now: number,
  ) =>
    transaction(
      Effect.gen(function* () {
        // Provider session setup and routing happen before ProviderService's
        // irreversible submission CAS. A missing project/session/model therefore
        // blocks this run and releases its slot instead of leaving a claim that
        // the scheduler retries forever.
        const rows = yield* sql<{
          record: string;
        }>`SELECT record FROM routine_runs WHERE id=${submission.runId}
      AND owner=${submission.owner} AND generation=${submission.generation}
      AND thread_id=${submission.threadId} AND message_id=${submission.messageId} AND command_id=${submission.commandId}
      AND submission_consumed=0 AND active=1`;
        if (!rows[0]) return false;
        const current = decodeRun(rows[0].record);
        yield* writeRun(
          { ...current, stage: "terminal", status: "blocked", detail, updatedAt: isoAt(now) },
          false,
        );
        return true;
      }),
    );
  const markWaitingForApproval = (
    input: {
      readonly threadId: ThreadId;
      readonly turnId: TurnId;
      readonly detail?: string | null | undefined;
    },
    now: number,
  ) =>
    transaction(
      Effect.gen(function* () {
        const rows = yield* sql<{ record: string }>`SELECT record FROM routine_runs
      WHERE thread_id=${input.threadId} AND active=1 AND submission_consumed=1
      ORDER BY admitted_at DESC, id DESC`;
        const current = rows
          .map((row) => decodeRun(row.record))
          .find(
            (run) =>
              run.stage === "provider-bound" &&
              run.turnId !== null &&
              String(run.turnId) === String(input.turnId),
          );
        if (!current) {
          yield* sql`INSERT INTO routine_provider_events(event_id, thread_id, provider_turn_id, initial_message_id, status, detail, observed_at)
        VALUES (${EventId.make(`routine-approval:${input.threadId}:${input.turnId}`)}, ${input.threadId}, ${input.turnId}, ${null}, ${"waiting-for-approval"}, ${input.detail ?? null}, ${now})
        ON CONFLICT(thread_id, provider_turn_id) DO UPDATE SET
          detail=COALESCE(excluded.detail, routine_provider_events.detail)
        WHERE routine_provider_events.status='waiting-for-approval'`;
          return false;
        }
        if (current.status === "waiting-for-approval") return true;
        yield* writeRun(
          {
            ...current,
            status: "waiting-for-approval",
            detail: input.detail ?? null,
            updatedAt: isoAt(now),
          },
          true,
        );
        return true;
      }),
    );
  const markProviderApprovalResolved = (
    input: {
      readonly threadId: ThreadId;
      readonly turnId: TurnId;
    },
    now: number,
  ) =>
    transaction(
      Effect.gen(function* () {
        const rows = yield* sql<{ record: string }>`SELECT record FROM routine_runs
      WHERE thread_id=${input.threadId} AND active=1 AND submission_consumed=1
      ORDER BY admitted_at DESC, id DESC`;
        const current = rows
          .map((row) => decodeRun(row.record))
          .find(
            (run) =>
              run.stage === "provider-bound" &&
              run.turnId !== null &&
              String(run.turnId) === String(input.turnId),
          );
        if (!current || current.status !== "waiting-for-approval") return false;
        yield* writeRun(
          { ...current, status: "running", detail: null, updatedAt: isoAt(now) },
          true,
        );
        return true;
      }),
    );
  const recordProviderTerminal = (
    input: {
      readonly eventId: EventId;
      readonly threadId: ThreadId;
      readonly turnId: TurnId;
      readonly messageId?: MessageId | undefined;
      readonly status: Extract<RoutineRun["status"], "succeeded" | "failed" | "interrupted">;
      readonly detail?: string | null | undefined;
    },
    now: number,
  ) =>
    transaction(
      Effect.gen(function* () {
        // Terminal evidence is durable before it is matched to the run. This
        // closes the adapter-return/bind gap and allows a later bind to consume
        // only the exact provider turn that returned from the adapter.
        const activeRuns = yield* sql<{ record: string }>`SELECT record FROM routine_runs
      WHERE thread_id=${input.threadId} AND active=1 AND submission_consumed=1
      ORDER BY admitted_at DESC, id DESC`;
        if (activeRuns.length === 0) return false;
        yield* sql`INSERT INTO routine_provider_events(event_id, thread_id, provider_turn_id, initial_message_id, status, detail, observed_at)
      VALUES (${input.eventId}, ${input.threadId}, ${input.turnId}, ${input.messageId ?? null}, ${input.status}, ${input.detail ?? null}, ${now})
      ON CONFLICT(thread_id, provider_turn_id) DO UPDATE SET
        initial_message_id=COALESCE(routine_provider_events.initial_message_id, excluded.initial_message_id),
        status=excluded.status,
        detail=excluded.detail,
        observed_at=excluded.observed_at`;
        const rows = yield* sql<{ record: string }>`SELECT record FROM routine_runs
      WHERE thread_id=${input.threadId} AND active=1 AND submission_consumed=1
      ORDER BY admitted_at DESC, id DESC`;
        const current =
          rows
            .map((row) => decodeRun(row.record))
            .find(
              (run) =>
                run.stage !== "terminal" &&
                run.turnId !== null &&
                String(run.turnId) === String(input.turnId) &&
                (input.messageId === undefined ||
                  String(run.messageId) === String(input.messageId)),
            ) ??
          (input.messageId === undefined
            ? undefined
            : rows
                .map((row) => decodeRun(row.record))
                .find(
                  (run) =>
                    run.stage !== "terminal" && String(run.messageId) === String(input.messageId),
                ));
        if (!current) return false;
        yield* sql`DELETE FROM routine_provider_events WHERE thread_id=${input.threadId} AND provider_turn_id=${input.turnId}`;
        yield* writeRun(
          {
            ...current,
            stage: "terminal",
            status: input.status,
            turnId: input.turnId,
            detail: input.detail ?? null,
            updatedAt: isoAt(now),
          },
          false,
        );
        return true;
      }),
    );
  const completeProviderTurn = (
    input: {
      readonly threadId: ThreadId;
      readonly messageId: MessageId;
      readonly turnId: TurnId;
      readonly status: Extract<RoutineRun["status"], "succeeded" | "failed" | "interrupted">;
      readonly detail?: string | null | undefined;
    },
    now: number,
  ) =>
    transaction(
      Effect.gen(function* () {
        // The initial message is the durable correlation anchor. A provider turn
        // id alone is insufficient while the first adapter response is still
        // pending: a later manual turn in the same thread must never settle this
        // run. Requiring the message id also makes omitted ids fail closed when a
        // stale caller reaches this boundary through an untyped path.
        if (input.messageId === undefined || input.turnId === undefined) return false;
        const rows = yield* sql<{ record: string }>`SELECT record FROM routine_runs
      WHERE thread_id=${input.threadId} AND message_id=${input.messageId}
        AND active=1 AND submission_consumed=1
      ORDER BY admitted_at DESC, id DESC`;
        const current = rows
          .map((row) => decodeRun(row.record))
          .find((run) => {
            if (run.stage === "terminal") return false;
            // Before the adapter returns there is no trustworthy provider-turn
            // identity to attach to a terminal event. Such evidence is persisted
            // by recordProviderTerminal and consumed by bindProviderTurn after
            // the adapter returns. A direct completion can only settle a bound
            // initial turn, and a missing id never acts as a wildcard.
            if (run.stage === "submitting") return false;
            return run.turnId !== null && String(run.turnId) === String(input.turnId);
          });
        if (!current) return false;
        yield* writeRun(
          {
            ...current,
            stage: "terminal",
            status: input.status,
            ...(current.turnId === null ? { turnId: input.turnId } : {}),
            detail: input.detail ?? null,
            updatedAt: isoAt(now),
          },
          false,
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
  const recoverConsumed = (now: number) =>
    transaction(
      Effect.gen(function* () {
        // A process can die after the irreversible provider submission CAS and
        // before the adapter result is bound. Such runs are deliberately absent
        // from preparation claims; surface them as attention while retaining the
        // active slot for exact provider evidence or an operator decision.
        const rows = yield* sql<{
          record: string;
          runOwner: string | null;
        }>`SELECT record, owner AS runOwner FROM routine_runs
      WHERE active=1 AND submission_consumed=1 ORDER BY admitted_at ASC, id ASC`;
        for (const row of rows) {
          const current = decodeRun(row.record);
          if (current.stage === "terminal") continue;

          // A terminal event may have been durably recorded while the process was
          // exiting. Reconcile it only when its provider turn exactly matches the
          // run's already-bound initial turn.
          if (current.turnId !== null) {
            const terminalRows = yield* sql<{
              status: Extract<RoutineRun["status"], "succeeded" | "failed" | "interrupted">;
              detail: string | null;
              initialMessageId: string | null;
            }>`SELECT status, detail, initial_message_id AS initialMessageId FROM routine_provider_events
          WHERE thread_id=${current.threadId} AND provider_turn_id=${current.turnId}
            AND status IN ('succeeded', 'failed', 'interrupted')`;
            const terminalEvent = terminalRows[0];
            if (
              terminalEvent &&
              (terminalEvent.initialMessageId === null ||
                terminalEvent.initialMessageId === String(current.messageId))
            ) {
              yield* sql`DELETE FROM routine_provider_events
            WHERE thread_id=${current.threadId} AND provider_turn_id=${current.turnId}`;
              yield* writeRun(
                {
                  ...current,
                  stage: "terminal",
                  status: terminalEvent.status,
                  detail: terminalEvent.detail,
                  updatedAt: isoAt(now),
                },
                false,
              );
              continue;
            }
          }

          // A provider may have completed after submission was consumed but before
          // the adapter returned its turn id. Normalized ingestion records the
          // initial message on that durable event. Reconcile only that exact
          // message/turn pair; a same-thread manual turn remains buffered.
          if (current.turnId === null) {
            const correlatedTerminalRows = yield* sql<{
              providerTurnId: string;
              status: Extract<RoutineRun["status"], "succeeded" | "failed" | "interrupted">;
              detail: string | null;
            }>`SELECT provider_turn_id AS providerTurnId, status, detail FROM routine_provider_events
          WHERE thread_id=${current.threadId} AND initial_message_id=${current.messageId}
            AND status IN ('succeeded', 'failed', 'interrupted')`;
            // The projection is the normalized durable fallback when the runtime
            // subscriber stopped after ProviderService persisted raw evidence but
            // before it could annotate that row with the initial message id.
            const projectedTerminalRows =
              correlatedTerminalRows.length > 0
                ? []
                : yield* sql<{
                    providerTurnId: string;
                    status: Extract<RoutineRun["status"], "succeeded" | "failed" | "interrupted">;
                    detail: string | null;
                  }>`SELECT events.provider_turn_id AS providerTurnId, events.status, events.detail
              FROM routine_provider_events AS events
              JOIN projection_turns AS turns
                ON turns.thread_id = events.thread_id
                AND turns.turn_id = events.provider_turn_id
                AND turns.pending_message_id = ${current.messageId}
              WHERE events.thread_id=${current.threadId}
                AND events.status IN ('succeeded', 'failed', 'interrupted')`;
            const terminalEvent = correlatedTerminalRows[0] ?? projectedTerminalRows[0];
            if (terminalEvent) {
              yield* sql`DELETE FROM routine_provider_events
            WHERE thread_id=${current.threadId} AND provider_turn_id=${terminalEvent.providerTurnId}`;
              yield* writeRun(
                {
                  ...current,
                  stage: "terminal",
                  status: terminalEvent.status,
                  turnId: TurnId.make(terminalEvent.providerTurnId),
                  detail: terminalEvent.detail,
                  updatedAt: isoAt(now),
                },
                false,
              );
              continue;
            }
          }

          // A live scheduler heartbeat means the owner may still be between the
          // irreversible CAS and the adapter response. Only a stale or missing
          // owner heartbeat is evidence that a process died and startup recovery
          // may surface the uncertain submission.
          const ownerHeartbeat =
            row.runOwner === null
              ? []
              : yield* sql<{ lastSeenAt: number }>`SELECT last_seen_at AS lastSeenAt
          FROM routine_scheduler_workers WHERE owner=${row.runOwner}`;
          if (
            ownerHeartbeat[0] !== undefined &&
            ownerHeartbeat[0].lastSeenAt > now - SCHEDULER_LEASE_MS
          ) {
            continue;
          }

          if (current.status !== "needs-attention") {
            yield* writeRun(
              {
                ...current,
                status: "needs-attention",
                detail:
                  "The server restarted after provider submission; inspect the provider conversation before retrying.",
                updatedAt: isoAt(now),
              },
              true,
            );
          }
        }
      }),
    );
  const findInitial = (submission: RoutineProviderSubmission) =>
    submissionClaim(submission).pipe(Effect.map((claim) => claim.run));
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
    consumeSubmission,
    consumeSubmissionForProvider,
    beginSessionPreparation,
    bindProviderTurn,
    markNeedsAttention,
    markBlockedBeforeSubmission,
    markWaitingForApproval,
    markProviderApprovalResolved,
    recordProviderTerminal,
    completeProviderTurn,
    settleOnSessionExit,
    updatePreparation,
    markSetupComplete,
    activeRuns,
    recoverConsumed,
    findInitial,
    submissionClaim,
  };
});
export class RoutineStore extends Context.Service<
  RoutineStore,
  Effect.Success<typeof makeRoutineStore>
>()("@kata-sh/code-cli/routines/RoutineStore") {}
export const RoutineStoreLive = Layer.effect(RoutineStore, makeRoutineStore);
