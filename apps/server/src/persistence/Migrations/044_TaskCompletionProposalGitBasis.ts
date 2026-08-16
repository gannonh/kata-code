import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Adds the proposal-time Git basis columns used to reject complete-then-mutate
 * and commit drift when a Build completion proposal settles. Nullable so
 * planning-stage proposals and any legacy internal proposals remain valid.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE task_workspace_completion_proposals ADD COLUMN proposal_commit_sha TEXT`.pipe(
    Effect.catch(() => Effect.void),
  );
  yield* sql`ALTER TABLE task_workspace_completion_proposals ADD COLUMN proposal_status_snapshot TEXT`.pipe(
    Effect.catch(() => Effect.void),
  );
});
