DELETE FROM "relay_linear_oauth_states"
WHERE "state_hash" IN (
	SELECT "state_hash"
	FROM (
		SELECT
			"state_hash",
			row_number() OVER (
				PARTITION BY "environment_id", "connection_id"
				ORDER BY "created_at" DESC, "state_hash" DESC
			) AS "state_rank"
		FROM "relay_linear_oauth_states"
		WHERE "consumed_at" IS NULL
	) AS "ranked_states"
	WHERE "state_rank" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_relay_linear_oauth_states_active_connection" ON "relay_linear_oauth_states" ("environment_id","connection_id") WHERE "consumed_at" is null;
