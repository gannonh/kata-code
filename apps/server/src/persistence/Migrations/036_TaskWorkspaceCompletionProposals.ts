import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

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
});
