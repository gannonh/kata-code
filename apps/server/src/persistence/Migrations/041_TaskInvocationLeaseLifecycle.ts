import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Completes the Task CLI lease lifecycle for databases that already recorded
 * migration 040 before expiry/reason columns were introduced.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE task_invocation_leases ADD COLUMN expires_at TEXT`.pipe(
    Effect.catch(() => Effect.void),
  );
  yield* sql`ALTER TABLE task_invocation_leases ADD COLUMN revocation_reason TEXT`.pipe(
    Effect.catch(() => Effect.void),
  );
  yield* sql`ALTER TABLE task_invocation_leases ADD COLUMN owner_generation TEXT NOT NULL DEFAULT 'legacy'`.pipe(
    Effect.catch(() => Effect.void),
  );

  // Keep the newest active lease per thread if an interrupted pre-rotation
  // implementation left more than one row. The partial unique index below
  // then makes future rotation atomic at the database boundary.
  yield* sql`
    UPDATE task_invocation_leases
    SET status = 'revoked',
        revoked_at = COALESCE(revoked_at, issued_at),
        revocation_reason = COALESCE(revocation_reason, 'superseded')
    WHERE status = 'active'
      AND rowid NOT IN (
        SELECT MAX(rowid)
        FROM task_invocation_leases
        WHERE status = 'active'
        GROUP BY thread_id
      )
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_invocation_leases_one_active_thread
    ON task_invocation_leases(thread_id)
    WHERE status = 'active'
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_invocation_leases_expiry
    ON task_invocation_leases(expires_at, status)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_invocation_leases_owner
    ON task_invocation_leases(thread_id, owner_generation, status)
  `;
});
