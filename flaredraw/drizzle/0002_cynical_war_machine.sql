CREATE TABLE `mcp_oauth_clients` (
	`client_id` text PRIMARY KEY NOT NULL,
	`client_secret` text,
	`redirect_uris` text NOT NULL,
	`client_name` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_oauth_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`code_challenge_method` text DEFAULT 'S256' NOT NULL,
	`scope` text,
	`client_state` text,
	`expires_at` integer NOT NULL,
	`used` integer DEFAULT false
);
--> statement-breakpoint
CREATE TABLE `mcp_oauth_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scope` text,
	`expires_at` integer NOT NULL,
	`refresh_token` text,
	`refresh_expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_oauth_tokens_refresh_token_unique` ON `mcp_oauth_tokens` (`refresh_token`);