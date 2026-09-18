CREATE TABLE `api_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_tail` text NOT NULL,
	`is_test` integer DEFAULT false NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_credentials_key_hash_unique` ON `api_credentials` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_credentials_business_idx` ON `api_credentials` (`business_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `api_webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`url` text NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_failure_at` integer,
	`last_success_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_webhooks_business_id_unique` ON `api_webhooks` (`business_id`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`key` text NOT NULL,
	`response` text NOT NULL,
	`status_code` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_keys_business_key_idx` ON `idempotency_keys` (`business_id`,`key`);--> statement-breakpoint
CREATE INDEX `idempotency_keys_created_idx` ON `idempotency_keys` (`created_at`);--> statement-breakpoint
CREATE TABLE `rate_counters` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`bucket` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_counters_business_bucket_idx` ON `rate_counters` (`business_id`,`bucket`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`payment_id` text,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`key_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`response_status` integer,
	`last_error` text,
	`delivered_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_deliveries_event_id_unique` ON `webhook_deliveries` (`event_id`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_due_idx` ON `webhook_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_business_created_idx` ON `webhook_deliveries` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_payment_idx` ON `webhook_deliveries` (`payment_id`);--> statement-breakpoint
-- automated-collections-api D3: relaxing NOT NULL on `wisphub_customer_id`
-- and `customer_usuario` forces SQLite's table rebuild — the one departure
-- from the constitution's additive rule, logged in plan.md's Complexity
-- Tracking. drizzle-kit's generated block was rewritten by hand here, for
-- two reasons, and the snapshot in meta/ is the generator's own:
--   1. D1's documented form for exactly this rebuild is
--      `PRAGMA defer_foreign_keys = true`, which holds every check until
--      the batch commits (both `wrangler d1 migrations apply` and the test
--      pool run one migration file as one batch); `PRAGMA foreign_keys=OFF`
--      is what the generator emits for plain SQLite, and D1's own guidance
--      does not list it. The local shim accepted both on 2026-09-17; the
--      documented one is used so dev and prod behave like the tests.
--   2. Under deferred checks the DROP counts every `payments` and
--      `proof_rejections` row as an orphan, and only an INSERT into the
--      table those rows reference brings the count back down. So the copy
--      happens *after* the rename, from a scratch table — the generator's
--      copy-then-drop order would fail the commit on any database that
--      holds a payment. Measured 2026-09-17 on the test pool's D1 with a
--      seeded link, payment and rejection.
-- The generator also selected the new columns from the old table, which do
-- not exist there yet; the copy below names only the columns both have.
PRAGMA defer_foreign_keys = true;--> statement-breakpoint
CREATE TABLE `__new_payment_links` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`token` text NOT NULL,
	`source` text DEFAULT 'panel' NOT NULL,
	`mode` text DEFAULT 'reusable' NOT NULL,
	`customer_ref` text,
	`ask_cents` integer,
	`label` text,
	`concept` text,
	`expires_at` integer,
	`closed_at` integer,
	`is_test` integer DEFAULT false NOT NULL,
	`wisphub_customer_id` text,
	`customer_usuario` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `__old_payment_links` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`token` text NOT NULL,
	`wisphub_customer_id` text,
	`customer_usuario` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__old_payment_links`("id", "business_id", "token", "wisphub_customer_id", "customer_usuario", "created_at") SELECT "id", "business_id", "token", "wisphub_customer_id", "customer_usuario", "created_at" FROM `payment_links`;--> statement-breakpoint
DROP TABLE `payment_links`;--> statement-breakpoint
ALTER TABLE `__new_payment_links` RENAME TO `payment_links`;--> statement-breakpoint
INSERT INTO `payment_links`("id", "business_id", "token", "wisphub_customer_id", "customer_usuario", "created_at") SELECT "id", "business_id", "token", "wisphub_customer_id", "customer_usuario", "created_at" FROM `__old_payment_links`;--> statement-breakpoint
DROP TABLE `__old_payment_links`;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_links_token_unique` ON `payment_links` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_links_panel_usuario_idx` ON `payment_links` (`business_id`,`customer_usuario`) WHERE source = 'panel';--> statement-breakpoint
CREATE UNIQUE INDEX `payment_links_api_ref_idx` ON `payment_links` (`business_id`,`customer_ref`) WHERE source = 'api' AND mode = 'reusable';--> statement-breakpoint
ALTER TABLE `payments` ADD `customer_ref` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `asked_cents` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `is_test` integer DEFAULT false NOT NULL;