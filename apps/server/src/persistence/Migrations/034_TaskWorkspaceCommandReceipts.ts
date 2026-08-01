import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

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
});
