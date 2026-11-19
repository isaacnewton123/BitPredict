CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`market_id` text,
	`model` text NOT NULL,
	`prompt_sha256` text NOT NULL,
	`input` text NOT NULL,
	`output` text,
	`valid` integer,
	`latency_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bets` (
	`id` text PRIMARY KEY NOT NULL,
	`market_id` text NOT NULL,
	`user_pubkey` text NOT NULL,
	`side` text NOT NULL,
	`amount_msat` integer NOT NULL,
	`payment_hash` text NOT NULL,
	`bolt11` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_pubkey`) REFERENCES `users`(`pubkey`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bets_amount_pos" CHECK("bets"."amount_msat" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bets_payment_hash_unique` ON `bets` (`payment_hash`);--> statement-breakpoint
CREATE INDEX `bets_market_status_idx` ON `bets` (`market_id`,`status`);--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`disputer_pubkey` text NOT NULL,
	`bond_payment_hash` text,
	`proof_urls` text NOT NULL,
	`nostr_event` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `disputes_bond_payment_hash_unique` ON `disputes` (`bond_payment_hash`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account` text NOT NULL,
	`amount_msat` integer NOT NULL,
	`ref_type` text NOT NULL,
	`ref_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `markets` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`creator_pubkey` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`category` text NOT NULL,
	`track` text NOT NULL,
	`title` text NOT NULL,
	`spec` text NOT NULL,
	`spec_sha256` text NOT NULL,
	`betting_cutoff` integer NOT NULL,
	`deadline_utc` integer NOT NULL,
	`resolve_after` integer NOT NULL,
	`pool_yes_msat` integer DEFAULT 0 NOT NULL,
	`pool_no_msat` integer DEFAULT 0 NOT NULL,
	`fee_bps` integer DEFAULT 200 NOT NULL,
	`outcome` text,
	`resolved_at` integer,
	`nostr_note_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`creator_pubkey`) REFERENCES `users`(`pubkey`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "markets_time_order" CHECK("markets"."betting_cutoff" <= "markets"."deadline_utc" AND "markets"."deadline_utc" <= "markets"."resolve_after")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `markets_slug_unique` ON `markets` (`slug`);--> statement-breakpoint
CREATE INDEX `markets_status_resolve_idx` ON `markets` (`status`,`resolve_after`);--> statement-breakpoint
CREATE INDEX `markets_category_status_idx` ON `markets` (`category`,`status`);--> statement-breakpoint
CREATE TABLE `nostr_events` (
	`id` text PRIMARY KEY NOT NULL,
	`market_id` text,
	`kind` integer NOT NULL,
	`event` text NOT NULL,
	`relays_ok` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `oracle_proofs` (
	`id` text PRIMARY KEY NOT NULL,
	`market_id` text NOT NULL,
	`provider` text NOT NULL,
	`url` text NOT NULL,
	`http_status` integer,
	`body` text,
	`body_sha256` text,
	`value` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`market_id` text NOT NULL,
	`user_pubkey` text NOT NULL,
	`kind` text NOT NULL,
	`amount_msat` integer NOT NULL,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`bolt11` text,
	`payment_hash` text,
	`preimage` text,
	`last_error` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_pubkey`) REFERENCES `users`(`pubkey`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payouts_market_user_kind_uq` ON `payouts` (`market_id`,`user_pubkey`,`kind`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`market_id` text NOT NULL,
	`signer_pubkey` text NOT NULL,
	`outcome` text NOT NULL,
	`proof_urls` text NOT NULL,
	`nostr_event` text NOT NULL,
	`bond_msat` integer DEFAULT 0 NOT NULL,
	`challenge_ends_at` integer NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `signers` (
	`pubkey` text PRIMARY KEY NOT NULL,
	`policy` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`resolved_count` integer DEFAULT 0 NOT NULL,
	`disputes_lost` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`pubkey` text PRIMARY KEY NOT NULL,
	`lightning_address` text,
	`nwc_uri_enc` text,
	`is_guest` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
