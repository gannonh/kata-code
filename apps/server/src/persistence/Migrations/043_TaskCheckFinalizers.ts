import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS task_check_finalizers (
      finalizer_hash TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      check_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      occurrence INTEGER NOT NULL,
      command_digest TEXT NOT NULL,
      canonical_cwd TEXT NOT NULL,
      timeout_ms INTEGER NOT NULL,
      max_output_bytes INTEGER NOT NULL,
      starting_commit_sha TEXT NOT NULL,
      starting_status TEXT NOT NULL,
      owner_generation TEXT NOT NULL DEFAULT 'legacy',
      status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'revoked')),
      issued_at TEXT NOT NULL,
      consumed_at TEXT,
      revoked_at TEXT,
      revocation_reason TEXT CHECK (revocation_reason IS NULL OR revocation_reason IN (
        'reconciled', 'superseded', 'orphan'
      ))
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_check_finalizers_attempt
    ON task_check_finalizers(attempt_id, status)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_check_finalizers_task
    ON task_check_finalizers(task_id, status)
  `;
});
