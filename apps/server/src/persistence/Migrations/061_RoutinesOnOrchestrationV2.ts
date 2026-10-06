import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Shown on routine runs that were in flight when the server moved to orchestration V2. */
export const UPGRADE_IN_FLIGHT_DETAIL =
  "Kata Code was updated while this run was in progress. Open the conversation to check what completed before running the routine again.";

/**
 * Routines launch through orchestration V2 from this migration on. Runs the
 * previous orchestrator had started (a thread, an accepted prompt, a provider
 * submission, or a bound provider turn) cannot be observed any more, so they
 * settle as needs-attention and free the routine's active slot.
 *
 * The previous dispatcher also worked on a run while it was still
 * `admitted`: once a worker claimed it (`generation > 0`), it could create the
 * `routine/<run id>` branch and worktree, run the setup script, and create the
 * thread before recording any later stage. Nothing records how far that got,
 * so a claimed run settles too. Admitted runs no worker ever claimed stay
 * queued and launch through V2.
 *
 * The provider-event buffer only served the previous orchestrator.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO routine_changes (environment_id, kind)
    SELECT DISTINCT routines.environment_id, 'changed'
    FROM routine_runs
    JOIN routines ON routines.id = routine_runs.routine_id
    WHERE routine_runs.active = 1 AND (
      routine_runs.submission_consumed = 1
      OR routine_runs.generation > 0
      OR routine_runs.stage IN ('thread-created', 'prompt-accepted', 'submitting', 'provider-bound')
    )
  `;
  yield* sql`
    UPDATE routine_runs
    SET
      active = 0,
      stage = 'terminal',
      record = json_set(
        record,
        '$.stage', 'terminal',
        '$.status', 'needs-attention',
        '$.detail', ${UPGRADE_IN_FLIGHT_DETAIL},
        '$.updatedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
    WHERE routine_runs.active = 1 AND (
      routine_runs.submission_consumed = 1
      OR routine_runs.generation > 0
      OR routine_runs.stage IN ('thread-created', 'prompt-accepted', 'submitting', 'provider-bound')
    )
  `;
  yield* sql`DROP TABLE IF EXISTS routine_provider_events`;
});
