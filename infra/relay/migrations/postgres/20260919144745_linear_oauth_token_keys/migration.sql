DROP INDEX "idx_relay_linear_oauth_states_connection";--> statement-breakpoint
DROP INDEX "idx_relay_linear_oauth_tokens_environment";--> statement-breakpoint
ALTER TABLE "relay_linear_oauth_tokens" DROP CONSTRAINT "relay_linear_oauth_tokens_pkey";--> statement-breakpoint
ALTER TABLE "relay_linear_oauth_tokens" ADD PRIMARY KEY ("environment_id","connection_id");--> statement-breakpoint
ALTER TABLE "relay_linear_oauth_states" ALTER COLUMN "expires_at" SET DATA TYPE bigint USING "expires_at"::bigint;--> statement-breakpoint
ALTER TABLE "relay_linear_oauth_tokens" ALTER COLUMN "expires_at" SET DATA TYPE bigint USING "expires_at"::bigint;