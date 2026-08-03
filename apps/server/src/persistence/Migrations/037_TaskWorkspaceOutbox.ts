import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

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
});
