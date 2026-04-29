CREATE TABLE "openai_subscription_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"chatgpt_account_id" text,
	"access_token_ciphertext" text NOT NULL,
	"refresh_token_ciphertext" text NOT NULL,
	"access_token_expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "openai_subscription_accounts" ADD CONSTRAINT "openai_subscription_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;