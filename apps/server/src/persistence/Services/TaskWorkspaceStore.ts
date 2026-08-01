import type {
  CommandId,
  EnvironmentId,
  IsoDateTime,
  TaskWorkspace,
  TaskWorkspaceCommandReceipt,
  TaskWorkspaceCompletionProposal,
  TaskWorkspaceEvent,
  TaskWorkspaceEventType,
  TaskWorkspaceId,
  TaskWorkspaceOperationReceipt,
  TaskWorkspaceOutboxEntry,
} from "@kata-sh/code-contracts";
import type * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import type * as Option from "effect/Option";

import type { TaskWorkspaceStoreError } from "../Errors.ts";

export interface TaskWorkspaceStoreCommitEvent {
  readonly eventId: string;
  readonly commandId: CommandId;
  readonly taskId: TaskWorkspaceId;
  readonly type: TaskWorkspaceEventType;
  readonly occurredAt: IsoDateTime;
  readonly task: TaskWorkspace;
}

/**
 * One atomic commit. A single transaction may append task events, upsert the
 * command and operation receipts, persist a completion proposal, and enqueue
 * outbox work.
 */
export interface TaskWorkspaceStoreCommitInput {
  readonly environmentId: EnvironmentId;
  readonly events: ReadonlyArray<TaskWorkspaceStoreCommitEvent>;
  readonly commandReceipt?: TaskWorkspaceCommandReceipt;
  readonly operationReceipt?: TaskWorkspaceOperationReceipt;
  readonly proposal?: TaskWorkspaceCompletionProposal;
  readonly outbox?: ReadonlyArray<TaskWorkspaceOutboxEntry>;
}

export interface TaskWorkspaceImportInput {
  readonly environmentId: EnvironmentId;
  /** Canonical events to import, already version-normalized by the caller. */
  readonly events: ReadonlyArray<TaskWorkspaceEvent>;
  /** Terminal `task.migrated` event per imported task, stamped with the server env. */
  readonly migratedEvents: ReadonlyArray<TaskWorkspaceEvent>;
}

/**
 * Transactional persistence for task-workspace aggregates, receipts, completion
 * proposals, and outbox rows. The service serializes commands and reduces in
 * memory; this store owns the durable, crash-safe append.
 */
export interface TaskWorkspaceStoreShape {
  readonly commit: (
    input: TaskWorkspaceStoreCommitInput,
  ) => Effect.Effect<ReadonlyArray<TaskWorkspaceEvent>, TaskWorkspaceStoreError>;
  readonly replayAll: () => Effect.Effect<
    ReadonlyArray<TaskWorkspaceEvent>,
    TaskWorkspaceStoreError
  >;
  readonly getCommandReceipt: (input: {
    readonly environmentId: EnvironmentId;
    readonly commandId: CommandId;
  }) => Effect.Effect<Option.Option<TaskWorkspaceCommandReceipt>, TaskWorkspaceStoreError>;
  readonly getOperationReceipt: (input: {
    readonly environmentId: EnvironmentId;
    readonly taskId: TaskWorkspaceId;
    readonly operationKey: string;
  }) => Effect.Effect<Option.Option<TaskWorkspaceOperationReceipt>, TaskWorkspaceStoreError>;
  /**
   * One-time transactional NDJSON import. After a successful import the legacy
   * file is retained read-only; the marker row prevents a second import.
   */
  readonly importLegacy: (
    input: TaskWorkspaceImportInput,
  ) => Effect.Effect<{ readonly importedEventCount: number }, TaskWorkspaceStoreError>;
  readonly readPendingOutbox: (
    limit: number,
  ) => Effect.Effect<ReadonlyArray<TaskWorkspaceOutboxEntry>, TaskWorkspaceStoreError>;
  readonly getOutboxByOperationKey: (input: {
    readonly environmentId: EnvironmentId;
    readonly taskId: TaskWorkspaceId;
    readonly operationKey: string;
  }) => Effect.Effect<Option.Option<TaskWorkspaceOutboxEntry>, TaskWorkspaceStoreError>;
  readonly upsertOutbox: (
    entry: TaskWorkspaceOutboxEntry,
  ) => Effect.Effect<void, TaskWorkspaceStoreError>;
  readonly upsertProposal: (
    proposal: TaskWorkspaceCompletionProposal,
  ) => Effect.Effect<void, TaskWorkspaceStoreError>;
  readonly getProposal: (input: {
    readonly taskId: TaskWorkspaceId;
    readonly occurrence: number;
    readonly providerTurnId: string;
  }) => Effect.Effect<Option.Option<TaskWorkspaceCompletionProposal>, TaskWorkspaceStoreError>;
}

export class TaskWorkspaceStore extends Context.Service<
  TaskWorkspaceStore,
  TaskWorkspaceStoreShape
>()("@kata-sh/code-cli/persistence/Services/TaskWorkspaceStore") {}
