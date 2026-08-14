import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS task_invocation_leases (
      token_hash TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      occurrence INTEGER NOT NULL,
      stage TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL,
      provider_turn_id TEXT NOT NULL,
      owner_generation TEXT NOT NULL DEFAULT 'legacy',
      status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
      issued_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT,
      revocation_reason TEXT CHECK (revocation_reason IS NULL OR revocation_reason IN (
        'superseded', 'terminal', 'failed', 'stopped', 'startup_orphan', 'orphan', 'manual'
      ))
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_invocation_leases_thread
    ON task_invocation_leases(thread_id, status)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_invocation_leases_turn
    ON task_invocation_leases(thread_id, provider_turn_id, status)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_invocation_leases_owner
    ON task_invocation_leases(thread_id, owner_generation, status)
  `;
});
