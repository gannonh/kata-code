// @effect-diagnostics preferSchemaOverJson:off - task snapshots, outbox payloads, and receipt
// arrays are persisted as JSON in TEXT columns and decoded through the contract schemas after
// JSON parsing, matching the legacy NDJSON format exactly.
// @effect-diagnostics globalDateInEffect:off - the import marker records the server clock time.
import {
  CommandId,
  EnvironmentId,
  IsoDateTime,
  TaskWorkspaceCommandReceipt,
  TaskWorkspaceCompletionProposal,
  TaskWorkspaceEvent,
  TaskWorkspaceEventType,
  TaskWorkspaceId,
  TaskWorkspaceOperationReceipt,
  TaskWorkspaceOutboxEntry,
} from "@kata-sh/code-contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  isPersistenceError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type TaskWorkspaceStoreError,
} from "../Errors.ts";
import {
  TaskWorkspaceStore,
  type TaskWorkspaceImportInput,
  type TaskWorkspaceStoreShape,
} from "../Services/TaskWorkspaceStore.ts";

const decodeEvent = Schema.decodeUnknownEffect(TaskWorkspaceEvent);
const decodeCommandReceipt = Schema.decodeUnknownEffect(TaskWorkspaceCommandReceipt);
const decodeOperationReceipt = Schema.decodeUnknownEffect(TaskWorkspaceOperationReceipt);
const decodeProposal = Schema.decodeUnknownEffect(TaskWorkspaceCompletionProposal);
const decodeOutbox = Schema.decodeUnknownEffect(TaskWorkspaceOutboxEntry);

const CommandReceiptRow = Schema.Struct({
  environmentId: EnvironmentId,
  commandId: CommandId,
  taskId: TaskWorkspaceId,
  commandType: Schema.String,
  commandDigest: Schema.String,
  operationKey: Schema.NullOr(Schema.String),
  status: Schema.String,
  resultEventId: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
});

const OperationReceiptRow = Schema.Struct({
  environmentId: EnvironmentId,
  taskId: TaskWorkspaceId,
  operationType: Schema.String,
  operationKey: Schema.String,
  payloadDigest: Schema.String,
  status: Schema.String,
  attemptCount: Schema.Number,
  sourceCommandIds: Schema.String,
  resultEventId: Schema.NullOr(Schema.String),
  resultTaskRevision: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

const ProposalRow = Schema.Struct({
  proposalId: Schema.String,
  environmentId: EnvironmentId,
  taskId: TaskWorkspaceId,
  stage: Schema.String,
  occurrence: Schema.Number,
  sessionId: Schema.String,
  threadId: Schema.String,
  providerTurnId: Schema.String,
  payloadDigest: Schema.String,
  summary: Schema.String,
  markdown: Schema.String,
  status: Schema.String,
  terminalTurnOutcome: Schema.NullOr(Schema.String),
  committedArtifactRevisionId: Schema.NullOr(Schema.String),
  rejectionReason: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  settledAt: Schema.NullOr(Schema.String),
});

const OutboxRow = Schema.Struct({
  outboxId: Schema.String,
  environmentId: EnvironmentId,
  taskId: TaskWorkspaceId,
  operationKey: Schema.String,
  target: Schema.String,
  status: Schema.String,
  payloadJson: Schema.String,
  attemptCount: Schema.Number,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(Schema.String),
});

const ImportMetaRow = Schema.Struct({
  id: Schema.String,
  importedAt: IsoDateTime,
  importedEnvironmentId: EnvironmentId,
  eventCount: Schema.Number,
});

function toSqlError(operation: string) {
  return (cause: unknown): TaskWorkspaceStoreError => toPersistenceSqlError(operation)(cause);
}

function toDecodeError(operation: string) {
  return (error: Schema.SchemaError): TaskWorkspaceStoreError =>
    toPersistenceDecodeError(operation)(error);
}

const makeStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertEvent = SqlSchema.findOne({
    Request: Schema.Struct({
      eventId: Schema.String,
      environmentId: EnvironmentId,
      taskId: TaskWorkspaceId,
      eventType: TaskWorkspaceEventType,
      commandId: CommandId,
      occurredAt: IsoDateTime,
      taskJson: Schema.String,
    }),
    Result: Schema.Struct({ sequence: Schema.Number }),
    execute: (request) =>
      sql`
        INSERT INTO task_workspace_events (
          event_id, environment_id, task_id, stream_version, event_type,
          command_id, occurred_at, task_json
        )
        VALUES (
          ${request.eventId}, ${request.environmentId}, ${request.taskId},
          COALESCE(
            (
              SELECT stream_version + 1
              FROM task_workspace_events
              WHERE environment_id = ${request.environmentId}
                AND task_id = ${request.taskId}
              ORDER BY stream_version DESC
              LIMIT 1
            ),
            0
          ),
          ${request.eventType}, ${request.commandId}, ${request.occurredAt}, ${request.taskJson}
        )
        RETURNING sequence
      `,
  });

  const replayEvents = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: Schema.Struct({
      sequence: Schema.Number,
      eventId: Schema.String,
      environmentId: EnvironmentId,
      taskId: TaskWorkspaceId,
      eventType: TaskWorkspaceEventType,
      commandId: CommandId,
      occurredAt: IsoDateTime,
      taskJson: Schema.String,
    }),
    execute: () => sql`
      SELECT sequence, event_id AS "eventId", environment_id AS "environmentId",
        task_id AS "taskId", event_type AS "eventType", command_id AS "commandId",
        occurred_at AS "occurredAt", task_json AS "taskJson"
      FROM task_workspace_events
      ORDER BY sequence ASC
    `,
  });

  const findCommandReceipt = SqlSchema.findOneOption({
    Request: Schema.Struct({ environmentId: EnvironmentId, commandId: CommandId }),
    Result: CommandReceiptRow,
    execute: (request) =>
      sql`
        SELECT environment_id AS "environmentId", command_id AS "commandId",
          task_id AS "taskId", command_type AS "commandType", command_digest AS "commandDigest",
          operation_key AS "operationKey", status, result_event_id AS "resultEventId",
          error, created_at AS "createdAt"
        FROM task_workspace_command_receipts
        WHERE environment_id = ${request.environmentId} AND command_id = ${request.commandId}
      `,
  });

  const findOperationReceipt = SqlSchema.findOneOption({
    Request: Schema.Struct({
      environmentId: EnvironmentId,
      taskId: TaskWorkspaceId,
      operationKey: Schema.String,
    }),
    Result: OperationReceiptRow,
    execute: (request) =>
      sql`
        SELECT environment_id AS "environmentId", task_id AS "taskId",
          operation_type AS "operationType", operation_key AS "operationKey",
          payload_digest AS "payloadDigest", status, attempt_count AS "attemptCount",
          source_command_ids AS "sourceCommandIds", result_event_id AS "resultEventId",
          result_task_revision AS "resultTaskRevision", error, created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM task_workspace_operation_receipts
        WHERE environment_id = ${request.environmentId} AND task_id = ${request.taskId}
          AND operation_key = ${request.operationKey}
      `,
  });

  const upsertCommandReceipt = SqlSchema.void({
    Request: CommandReceiptRow,
    execute: (request) =>
      sql`
        INSERT INTO task_workspace_command_receipts (
          environment_id, command_id, task_id, command_type, command_digest,
          operation_key, status, result_event_id, error, created_at
        )
        VALUES (
          ${request.environmentId}, ${request.commandId}, ${request.taskId},
          ${request.commandType}, ${request.commandDigest}, ${request.operationKey},
          ${request.status}, ${request.resultEventId}, ${request.error}, ${request.createdAt}
        )
        ON CONFLICT (environment_id, command_id) DO UPDATE SET
          status = excluded.status,
          result_event_id = excluded.result_event_id,
          error = excluded.error
      `,
  });

  const upsertOperationReceipt = SqlSchema.void({
    Request: OperationReceiptRow,
    execute: (request) =>
      sql`
        INSERT INTO task_workspace_operation_receipts (
          environment_id, task_id, operation_type, operation_key, payload_digest,
          status, attempt_count, source_command_ids, result_event_id,
          result_task_revision, error, created_at, updated_at
        )
        VALUES (
          ${request.environmentId}, ${request.taskId}, ${request.operationType},
          ${request.operationKey}, ${request.payloadDigest}, ${request.status},
          ${request.attemptCount}, ${request.sourceCommandIds}, ${request.resultEventId},
          ${request.resultTaskRevision}, ${request.error}, ${request.createdAt}, ${request.updatedAt}
        )
        ON CONFLICT (environment_id, task_id, operation_key) DO UPDATE SET
          operation_type = excluded.operation_type,
          payload_digest = excluded.payload_digest,
          status = excluded.status,
          attempt_count = excluded.attempt_count,
          source_command_ids = excluded.source_command_ids,
          result_event_id = excluded.result_event_id,
          result_task_revision = excluded.result_task_revision,
          error = excluded.error,
          updated_at = excluded.updated_at
      `,
  });

  const upsertProposalRow = SqlSchema.void({
    Request: ProposalRow,
    execute: (request) =>
      sql`
        INSERT INTO task_workspace_completion_proposals (
          proposal_id, environment_id, task_id, stage, occurrence, session_id,
          thread_id, provider_turn_id, payload_digest, summary, markdown, status,
          terminal_turn_outcome, committed_artifact_revision_id, rejection_reason,
          created_at, settled_at
        )
        VALUES (
          ${request.proposalId}, ${request.environmentId}, ${request.taskId},
          ${request.stage}, ${request.occurrence}, ${request.sessionId},
          ${request.threadId}, ${request.providerTurnId}, ${request.payloadDigest},
          ${request.summary}, ${request.markdown}, ${request.status},
          ${request.terminalTurnOutcome}, ${request.committedArtifactRevisionId},
          ${request.rejectionReason}, ${request.createdAt}, ${request.settledAt}
        )
        ON CONFLICT (task_id, occurrence, provider_turn_id) DO UPDATE SET
          status = excluded.status,
          terminal_turn_outcome = excluded.terminal_turn_outcome,
          committed_artifact_revision_id = excluded.committed_artifact_revision_id,
          rejection_reason = excluded.rejection_reason,
          settled_at = excluded.settled_at
      `,
  });

  const insertOutboxRow = SqlSchema.void({
    Request: OutboxRow,
    execute: (request) =>
      sql`
        INSERT INTO task_workspace_outbox (
          outbox_id, environment_id, task_id, operation_key, target, status,
          payload_json, attempt_count, created_at, updated_at, completed_at
        )
        VALUES (
          ${request.outboxId}, ${request.environmentId}, ${request.taskId},
          ${request.operationKey}, ${request.target}, ${request.status},
          ${request.payloadJson}, ${request.attemptCount}, ${request.createdAt},
          ${request.updatedAt}, ${request.completedAt}
        )
        ON CONFLICT (environment_id, task_id, operation_key) DO UPDATE SET
          target = excluded.target,
          status = excluded.status,
          payload_json = excluded.payload_json,
          attempt_count = excluded.attempt_count,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at
      `,
  });

  const findOutboxByOperationKey = SqlSchema.findOneOption({
    Request: Schema.Struct({
      environmentId: EnvironmentId,
      taskId: TaskWorkspaceId,
      operationKey: Schema.String,
    }),
    Result: OutboxRow,
    execute: (request) =>
      sql`
        SELECT outbox_id AS "outboxId", environment_id AS "environmentId",
          task_id AS "taskId", operation_key AS "operationKey", target, status,
          payload_json AS "payloadJson", attempt_count AS "attemptCount",
          created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"
        FROM task_workspace_outbox
        WHERE environment_id = ${request.environmentId} AND task_id = ${request.taskId}
          AND operation_key = ${request.operationKey}
      `,
  });

  const readPendingOutboxRows = SqlSchema.findAll({
    Request: Schema.Struct({ environmentId: EnvironmentId, limit: Schema.Number }),
    Result: OutboxRow,
    execute: (request) =>
      sql`
        SELECT outbox_id AS "outboxId", environment_id AS "environmentId",
          task_id AS "taskId", operation_key AS "operationKey", target, status,
          payload_json AS "payloadJson", attempt_count AS "attemptCount",
          created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"
        FROM task_workspace_outbox
        WHERE environment_id = ${request.environmentId} AND status IN ('pending', 'failed')
        ORDER BY created_at ASC
        LIMIT ${request.limit}
      `,
  });

  const findProposal = SqlSchema.findOneOption({
    Request: Schema.Struct({
      taskId: TaskWorkspaceId,
      occurrence: Schema.Number,
      providerTurnId: Schema.String,
    }),
    Result: ProposalRow,
    execute: (request) =>
      sql`
        SELECT proposal_id AS "proposalId", environment_id AS "environmentId",
          task_id AS "taskId", stage, occurrence, session_id AS "sessionId",
          thread_id AS "threadId", provider_turn_id AS "providerTurnId",
          payload_digest AS "payloadDigest", summary, markdown, status,
          terminal_turn_outcome AS "terminalTurnOutcome",
          committed_artifact_revision_id AS "committedArtifactRevisionId",
          rejection_reason AS "rejectionReason", created_at AS "createdAt",
          settled_at AS "settledAt"
        FROM task_workspace_completion_proposals
        WHERE task_id = ${request.taskId} AND occurrence = ${request.occurrence}
          AND provider_turn_id = ${request.providerTurnId}
      `,
  });

  const readPendingProposalRows = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: ProposalRow,
    execute: () =>
      sql`
        SELECT proposal_id AS "proposalId", environment_id AS "environmentId",
          task_id AS "taskId", stage, occurrence, session_id AS "sessionId",
          thread_id AS "threadId", provider_turn_id AS "providerTurnId",
          payload_digest AS "payloadDigest", summary, markdown, status,
          terminal_turn_outcome AS "terminalTurnOutcome",
          committed_artifact_revision_id AS "committedArtifactRevisionId",
          rejection_reason AS "rejectionReason", created_at AS "createdAt",
          settled_at AS "settledAt"
        FROM task_workspace_completion_proposals
        WHERE status = 'proposed'
        ORDER BY created_at ASC
      `,
  });

  const readImportMeta = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: Schema.String }),
    Result: ImportMetaRow,
    execute: (request) =>
      sql`
        SELECT id, imported_at AS "importedAt",
          imported_environment_id AS "importedEnvironmentId",
          event_count AS "eventCount"
        FROM task_workspace_import_meta
        WHERE id = ${request.id}
      `,
  });

  const insertImportMeta = SqlSchema.void({
    Request: ImportMetaRow,
    execute: (request) =>
      sql`
        INSERT INTO task_workspace_import_meta (
          id, imported_at, imported_environment_id, event_count
        )
        VALUES (${request.id}, ${request.importedAt}, ${request.importedEnvironmentId}, ${request.eventCount})
      `,
  });

  const commit: TaskWorkspaceStoreShape["commit"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const stored: TaskWorkspaceEvent[] = [];
          for (const event of input.events) {
            const row = yield* insertEvent({
              eventId: event.eventId,
              environmentId: input.environmentId,
              taskId: event.taskId,
              eventType: event.type,
              commandId: event.commandId,
              occurredAt: event.occurredAt,
              taskJson: JSON.stringify(event.task),
            }).pipe(Effect.mapError(toSqlError("TaskWorkspaceStore.commit:insertEvent")));
            stored.push({ ...event, sequence: row.sequence });
          }
          if (input.commandReceipt) {
            yield* upsertCommandReceipt({
              environmentId: input.commandReceipt.environmentId,
              commandId: input.commandReceipt.commandId,
              taskId: input.commandReceipt.taskId,
              commandType: input.commandReceipt.commandType,
              commandDigest: input.commandReceipt.commandDigest,
              operationKey: input.commandReceipt.operationKey,
              status: input.commandReceipt.status,
              resultEventId: input.commandReceipt.resultEventId,
              error: input.commandReceipt.error,
              createdAt: input.commandReceipt.createdAt,
            }).pipe(Effect.mapError(toSqlError("TaskWorkspaceStore.commit:upsertCommandReceipt")));
          }
          if (input.operationReceipt) {
            yield* upsertOperationReceipt({
              environmentId: input.operationReceipt.environmentId,
              taskId: input.operationReceipt.taskId,
              operationType: input.operationReceipt.operationType,
              operationKey: input.operationReceipt.operationKey,
              payloadDigest: input.operationReceipt.payloadDigest,
              status: input.operationReceipt.status,
              attemptCount: input.operationReceipt.attemptCount,
              sourceCommandIds: JSON.stringify(input.operationReceipt.sourceCommandIds),
              resultEventId: input.operationReceipt.resultEventId,
              resultTaskRevision: input.operationReceipt.resultTaskRevision,
              error: input.operationReceipt.error,
              createdAt: input.operationReceipt.createdAt,
              updatedAt: input.operationReceipt.updatedAt,
            }).pipe(
              Effect.mapError(toSqlError("TaskWorkspaceStore.commit:upsertOperationReceipt")),
            );
          }
          if (input.proposal) {
            yield* upsertProposalRow({
              proposalId: input.proposal.id,
              environmentId: input.proposal.environmentId,
              taskId: input.proposal.taskId,
              stage: input.proposal.stage,
              occurrence: input.proposal.occurrence,
              sessionId: input.proposal.sessionId,
              threadId: input.proposal.threadId,
              providerTurnId: input.proposal.providerTurnId,
              payloadDigest: input.proposal.payloadDigest,
              summary: input.proposal.summary,
              markdown: input.proposal.markdown,
              status: input.proposal.status,
              terminalTurnOutcome: input.proposal.terminalTurnOutcome,
              committedArtifactRevisionId: input.proposal.committedArtifactRevisionId,
              rejectionReason: input.proposal.rejectionReason,
              createdAt: input.proposal.createdAt,
              settledAt: input.proposal.settledAt,
            }).pipe(Effect.mapError(toSqlError("TaskWorkspaceStore.commit:upsertProposal")));
          }
          for (const entry of input.outbox ?? []) {
            yield* insertOutboxRow({
              outboxId: entry.id,
              environmentId: entry.environmentId,
              taskId: entry.taskId,
              operationKey: entry.operationKey,
              target: entry.target,
              status: entry.status,
              payloadJson: JSON.stringify(entry.payload),
              attemptCount: entry.attemptCount,
              createdAt: entry.createdAt,
              updatedAt: entry.updatedAt,
              completedAt: entry.completedAt,
            }).pipe(Effect.mapError(toSqlError("TaskWorkspaceStore.commit:insertOutbox")));
          }
          return stored;
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          isPersistenceError(cause)
            ? cause
            : toPersistenceSqlError("TaskWorkspaceStore.commit")(cause),
        ),
      );

  const replayAll: TaskWorkspaceStoreShape["replayAll"] = () =>
    replayEvents({}).pipe(
      Effect.mapError(toSqlError("TaskWorkspaceStore.replayAll:query")),
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          decodeEvent({
            sequence: row.sequence,
            eventId: row.eventId,
            commandId: row.commandId,
            taskId: row.taskId,
            type: row.eventType,
            occurredAt: row.occurredAt,
            task: JSON.parse(row.taskJson) as unknown,
          }).pipe(Effect.mapError(toDecodeError("TaskWorkspaceStore.replayAll:rowToEvent"))),
        ),
      ),
    );

  const importLegacy: TaskWorkspaceStoreShape["importLegacy"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const existing = yield* readImportMeta({ id: "legacy-ndjson" }).pipe(
            Effect.mapError(toSqlError("TaskWorkspaceStore.importLegacy:readMarker")),
          );
          if (Option.isSome(existing)) {
            return { importedEventCount: 0 };
          }
          for (const event of input.events) {
            yield* insertEvent({
              eventId: event.eventId,
              environmentId: input.environmentId,
              taskId: event.taskId,
              eventType: event.type,
              commandId: event.commandId,
              occurredAt: event.occurredAt,
              taskJson: JSON.stringify(event.task),
            }).pipe(Effect.mapError(toSqlError("TaskWorkspaceStore.importLegacy:insertEvent")));
          }
          for (const event of input.migratedEvents) {
            yield* insertEvent({
              eventId: event.eventId,
              environmentId: input.environmentId,
              taskId: event.taskId,
              eventType: event.type,
              commandId: event.commandId,
              occurredAt: event.occurredAt,
              taskJson: JSON.stringify(event.task),
            }).pipe(Effect.mapError(toSqlError("TaskWorkspaceStore.importLegacy:insertMigrated")));
          }
          yield* insertImportMeta({
            id: "legacy-ndjson",
            importedAt: input.events[0]?.occurredAt ?? DateTime.formatIso(yield* DateTime.now),
            importedEnvironmentId: input.environmentId,
            eventCount: input.events.length + input.migratedEvents.length,
          }).pipe(Effect.mapError(toSqlError("TaskWorkspaceStore.importLegacy:insertMarker")));
          return { importedEventCount: input.events.length + input.migratedEvents.length };
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          isPersistenceError(cause)
            ? cause
            : toPersistenceSqlError("TaskWorkspaceStore.importLegacy")(cause),
        ),
      );

  const readPendingOutbox: TaskWorkspaceStoreShape["readPendingOutbox"] = ({
    environmentId,
    limit,
  }) =>
    readPendingOutboxRows({ environmentId, limit }).pipe(
      Effect.mapError(toSqlError("TaskWorkspaceStore.readPendingOutbox:query")),
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          decodeOutbox({
            id: row.outboxId,
            environmentId: row.environmentId,
            taskId: row.taskId,
            operationKey: row.operationKey,
            target: row.target,
            status: row.status,
            payload: JSON.parse(row.payloadJson) as unknown,
            attemptCount: row.attemptCount,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            completedAt: row.completedAt,
          }).pipe(Effect.mapError(toDecodeError("TaskWorkspaceStore.readPendingOutbox:row"))),
        ),
      ),
    );

  const upsertOutbox: TaskWorkspaceStoreShape["upsertOutbox"] = (entry) =>
    insertOutboxRow({
      outboxId: entry.id,
      environmentId: entry.environmentId,
      taskId: entry.taskId,
      operationKey: entry.operationKey,
      target: entry.target,
      status: entry.status,
      payloadJson: JSON.stringify(entry.payload),
      attemptCount: entry.attemptCount,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      completedAt: entry.completedAt,
    }).pipe(Effect.mapError(toSqlError("TaskWorkspaceStore.upsertOutbox")));

  const upsertProposal: TaskWorkspaceStoreShape["upsertProposal"] = (proposal) =>
    upsertProposalRow({
      proposalId: proposal.id,
      environmentId: proposal.environmentId,
      taskId: proposal.taskId,
      stage: proposal.stage,
      occurrence: proposal.occurrence,
      sessionId: proposal.sessionId,
      threadId: proposal.threadId,
      providerTurnId: proposal.providerTurnId,
      payloadDigest: proposal.payloadDigest,
      summary: proposal.summary,
      markdown: proposal.markdown,
      status: proposal.status,
      terminalTurnOutcome: proposal.terminalTurnOutcome,
      committedArtifactRevisionId: proposal.committedArtifactRevisionId,
      rejectionReason: proposal.rejectionReason,
      createdAt: proposal.createdAt,
      settledAt: proposal.settledAt,
    }).pipe(Effect.mapError(toSqlError("TaskWorkspaceStore.upsertProposal")));

  return {
    commit,
    replayAll,
    getCommandReceipt: (input) =>
      findCommandReceipt(input).pipe(
        Effect.mapError(toSqlError("TaskWorkspaceStore.getCommandReceipt:query")),
        Effect.map((option) =>
          Option.map(option, (row) =>
            Schema.decodeUnknownSync(TaskWorkspaceCommandReceipt)({
              environmentId: row.environmentId,
              commandId: row.commandId,
              taskId: row.taskId,
              commandType: row.commandType,
              commandDigest: row.commandDigest,
              operationKey: row.operationKey,
              status: row.status,
              resultEventId: row.resultEventId,
              error: row.error,
              createdAt: row.createdAt,
            }),
          ),
        ),
      ),
    getOperationReceipt: (input) =>
      findOperationReceipt(input).pipe(
        Effect.mapError(toSqlError("TaskWorkspaceStore.getOperationReceipt:query")),
        Effect.map((option) =>
          Option.map(option, (row) =>
            Schema.decodeUnknownSync(TaskWorkspaceOperationReceipt)({
              environmentId: row.environmentId,
              taskId: row.taskId,
              operationType: row.operationType,
              operationKey: row.operationKey,
              payloadDigest: row.payloadDigest,
              status: row.status,
              attemptCount: row.attemptCount,
              sourceCommandIds: JSON.parse(row.sourceCommandIds) as string[],
              resultEventId: row.resultEventId,
              resultTaskRevision: row.resultTaskRevision,
              error: row.error,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            }),
          ),
        ),
      ),
    importLegacy,
    readPendingOutbox,
    getOutboxByOperationKey: (input) =>
      findOutboxByOperationKey(input).pipe(
        Effect.mapError(toSqlError("TaskWorkspaceStore.getOutboxByOperationKey:query")),
        Effect.map((option) =>
          Option.map(option, (row) =>
            Schema.decodeUnknownSync(TaskWorkspaceOutboxEntry)({
              id: row.outboxId,
              environmentId: row.environmentId,
              taskId: row.taskId,
              operationKey: row.operationKey,
              target: row.target,
              status: row.status,
              payload: JSON.parse(row.payloadJson) as unknown,
              attemptCount: row.attemptCount,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              completedAt: row.completedAt,
            }),
          ),
        ),
      ),
    upsertOutbox,
    upsertProposal,
    getProposal: (input) =>
      findProposal(input).pipe(
        Effect.mapError(toSqlError("TaskWorkspaceStore.getProposal:query")),
        Effect.map((option) =>
          Option.map(option, (row) =>
            Schema.decodeUnknownSync(TaskWorkspaceCompletionProposal)({
              id: row.proposalId,
              environmentId: row.environmentId,
              taskId: row.taskId,
              stage: row.stage,
              occurrence: row.occurrence,
              sessionId: row.sessionId,
              threadId: row.threadId,
              providerTurnId: row.providerTurnId,
              payloadDigest: row.payloadDigest,
              summary: row.summary,
              markdown: row.markdown,
              status: row.status,
              terminalTurnOutcome: row.terminalTurnOutcome,
              committedArtifactRevisionId: row.committedArtifactRevisionId,
              rejectionReason: row.rejectionReason,
              createdAt: row.createdAt,
              settledAt: row.settledAt,
            }),
          ),
        ),
      ),
    readPendingProposals: () =>
      readPendingProposalRows({}).pipe(
        Effect.mapError(toSqlError("TaskWorkspaceStore.readPendingProposals:query")),
        Effect.map((rows) =>
          rows.map((row) =>
            Schema.decodeUnknownSync(TaskWorkspaceCompletionProposal)({
              id: row.proposalId,
              environmentId: row.environmentId,
              taskId: row.taskId,
              stage: row.stage,
              occurrence: row.occurrence,
              sessionId: row.sessionId,
              threadId: row.threadId,
              providerTurnId: row.providerTurnId,
              payloadDigest: row.payloadDigest,
              summary: row.summary,
              markdown: row.markdown,
              status: row.status,
              terminalTurnOutcome: row.terminalTurnOutcome,
              committedArtifactRevisionId: row.committedArtifactRevisionId,
              rejectionReason: row.rejectionReason,
              createdAt: row.createdAt,
              settledAt: row.settledAt,
            }),
          ),
        ),
      ),
  } satisfies TaskWorkspaceStoreShape;
});

export const TaskWorkspaceStoreLive = Layer.effect(TaskWorkspaceStore, makeStore);
