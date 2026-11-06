-- FlareDraw schema integration

CREATE TABLE IF NOT EXISTS `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT 0 NOT NULL,
	`image` text,
	`createdAt` text DEFAULT (datetime('now')) NOT NULL,
	`updatedAt` text DEFAULT (datetime('now')) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `user_email_unique` ON `user` (`email`);

CREATE TABLE IF NOT EXISTS `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` text NOT NULL,
	`token` text NOT NULL,
	`createdAt` text DEFAULT (datetime('now')) NOT NULL,
	`updatedAt` text DEFAULT (datetime('now')) NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL REFERENCES `user`(`id`)
);
CREATE UNIQUE INDEX IF NOT EXISTS `session_token_unique` ON `session` (`token`);

CREATE TABLE IF NOT EXISTS `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL REFERENCES `user`(`id`),
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` text,
	`refreshTokenExpiresAt` text,
	`scope` text,
	`password` text,
	`createdAt` text DEFAULT (datetime('now')) NOT NULL,
	`updatedAt` text DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE IF NOT EXISTS `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` text NOT NULL,
	`createdAt` text DEFAULT (datetime('now')) NOT NULL,
	`updatedAt` text DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE IF NOT EXISTS `drawings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `user`(`id`),
	`title` text DEFAULT 'Untitled',
	`project` text DEFAULT 'default',
	`r2_key` text NOT NULL,
	`thumbnail_key` text,
	`is_public` integer DEFAULT 0,
	`share_id` text UNIQUE,
	`element_count` integer DEFAULT 0,
	`last_modified` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE IF NOT EXISTS `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`drawing_id` text REFERENCES `drawings`(`id`),
	`r2_key` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`expires_at` text,
	`view_count` integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `user`(`id`),
	`title` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`is_pinned` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE IF NOT EXISTS `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
	`name` text NOT NULL,
	`token` text NOT NULL UNIQUE,
	`token_prefix` text NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE IF NOT EXISTS `mcp_oauth_clients` (
	`client_id` text PRIMARY KEY NOT NULL,
	`client_secret` text,
	`redirect_uris` text NOT NULL,
	`client_name` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE IF NOT EXISTS `mcp_oauth_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`code_challenge_method` text DEFAULT 'S256' NOT NULL,
	`scope` text,
	`client_state` text,
	`expires_at` integer NOT NULL,
	`used` integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS `mcp_oauth_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL REFERENCES `user`(`id`),
	`scope` text,
	`expires_at` integer NOT NULL,
	`refresh_token` text UNIQUE,
	`refresh_expires_at` integer
);

-- Seed default user for FlareDraw
INSERT OR IGNORE INTO `user` (`id`, `name`, `email`, `emailVerified`)
VALUES ('local-user', 'FlareDraw Owner', 'owner@flaredraw.local', 1);
