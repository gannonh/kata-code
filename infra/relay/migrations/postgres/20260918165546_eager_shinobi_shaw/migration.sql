CREATE TABLE "relay_linear_oauth_states" (
	"state_hash" varchar(64) PRIMARY KEY,
	"user_id" varchar(191) NOT NULL,
	"environment_id" varchar(191) NOT NULL,
	"connection_id" varchar(128) NOT NULL,
	"code_verifier" text NOT NULL,
	"expires_at" integer NOT NULL,
	"consumed_at" varchar(64),
	"created_at" varchar(64) NOT NULL,
	"updated_at" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relay_linear_oauth_tokens" (
	"user_id" varchar(191),
	"environment_id" varchar(191),
	"connection_id" varchar(128),
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" integer NOT NULL,
	"scope" text NOT NULL,
	"created_at" varchar(64) NOT NULL,
	"updated_at" varchar(64) NOT NULL,
	CONSTRAINT "relay_linear_oauth_tokens_pkey" PRIMARY KEY("user_id","environment_id","connection_id")
);
--> statement-breakpoint
CREATE INDEX "idx_relay_linear_oauth_states_expires_at" ON "relay_linear_oauth_states" ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_relay_linear_oauth_states_connection" ON "relay_linear_oauth_states" ("environment_id","connection_id");--> statement-breakpoint
CREATE INDEX "idx_relay_linear_oauth_tokens_environment" ON "relay_linear_oauth_tokens" ("environment_id");