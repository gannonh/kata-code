import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

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
});
