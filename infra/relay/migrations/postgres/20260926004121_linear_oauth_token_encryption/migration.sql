DELETE FROM "relay_linear_oauth_tokens";--> statement-breakpoint
ALTER TABLE "relay_linear_oauth_tokens" ADD COLUMN "token_ciphertext" text NOT NULL;--> statement-breakpoint
ALTER TABLE "relay_linear_oauth_tokens" ADD COLUMN "token_nonce" varchar(16) NOT NULL;--> statement-breakpoint
ALTER TABLE "relay_linear_oauth_tokens" ADD COLUMN "key_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "relay_linear_oauth_tokens" DROP COLUMN "access_token";--> statement-breakpoint
ALTER TABLE "relay_linear_oauth_tokens" DROP COLUMN "refresh_token";