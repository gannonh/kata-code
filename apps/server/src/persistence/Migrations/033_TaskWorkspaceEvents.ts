import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

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
});
