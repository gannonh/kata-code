import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

/**
 * Recreates task-workspace tables for databases that recorded migrations 033-038
 * before those tables were present. Every statement is idempotent so this also
 * remains safe for databases with a complete task-workspace schema.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_workspace_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      environment_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      stream_version INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      command_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      task_json TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_events_stream_version
    ON task_workspace_events(environment_id, task_id, stream_version)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_events_stream_sequence
    ON task_workspace_events(environment_id, task_id, sequence)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_events_command_id
    ON task_workspace_events(command_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_workspace_command_receipts (
      environment_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      command_digest TEXT NOT NULL,
      operation_key TEXT,
      status TEXT NOT NULL,
      result_event_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (environment_id, command_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_command_receipts_task
    ON task_workspace_command_receipts(environment_id, task_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_workspace_operation_receipts (
      environment_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      operation_key TEXT NOT NULL,
      payload_digest TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      source_command_ids TEXT NOT NULL,
      result_event_id TEXT,
      result_task_revision INTEGER,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (environment_id, task_id, operation_key)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_workspace_completion_proposals (
      proposal_id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      occurrence INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      provider_turn_id TEXT NOT NULL,
      payload_digest TEXT NOT NULL,
      summary TEXT NOT NULL,
      markdown TEXT NOT NULL,
      status TEXT NOT NULL,
      terminal_turn_outcome TEXT,
      committed_artifact_revision_id TEXT,
      rejection_reason TEXT,
      created_at TEXT NOT NULL,
      settled_at TEXT,
      UNIQUE (task_id, occurrence, provider_turn_id)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_workspace_outbox (
      outbox_id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      operation_key TEXT NOT NULL,
      target TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE (environment_id, task_id, operation_key)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS task_workspace_import_meta (
      id TEXT PRIMARY KEY,
      imported_at TEXT NOT NULL,
      imported_environment_id TEXT NOT NULL,
      event_count INTEGER NOT NULL
    )
  `;
});
