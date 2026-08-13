CREATE TABLE `cash_drops` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text,
	`confirmed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cash_drops_store_idx` ON `cash_drops` (`store_id`);--> statement-breakpoint
CREATE TABLE `charges` (
	`id` text PRIMARY KEY NOT NULL,
	`isp_id` text NOT NULL,
	`store_id` text NOT NULL,
	`folio` text NOT NULL,
	`wisphub_customer_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_zone` text,
	`monthly_fee_cents` integer NOT NULL,
	`service_fee_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`reconnection_status` text DEFAULT 'queued' NOT NULL,
	`reconnection_attempts` integer DEFAULT 0 NOT NULL,
	`reconnected_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`isp_id`) REFERENCES `isps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `charges_folio_unique` ON `charges` (`folio`);--> statement-breakpoint
CREATE INDEX `charges_store_idx` ON `charges` (`store_id`);--> statement-breakpoint
CREATE INDEX `charges_isp_created_idx` ON `charges` (`isp_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`token` text NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_unique` ON `invitations` (`token`);--> statement-breakpoint
CREATE INDEX `invitations_store_idx` ON `invitations` (`store_id`);--> statement-breakpoint
CREATE TABLE `isps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`password_hash` text,
	`password_salt` text,
	`wisphub_api_key` text,
	`service_fee_cents` integer DEFAULT 1500 NOT NULL,
	`store_commission_cents` integer DEFAULT 900 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `isps_email_unique` ON `isps` (`email`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`type` text NOT NULL,
	`cents` integer NOT NULL,
	`charge_id` text,
	`cash_drop_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`charge_id`) REFERENCES `charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_drop_id`) REFERENCES `cash_drops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_entries_store_created_idx` ON `ledger_entries` (`store_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`isp_id` text NOT NULL,
	`name` text NOT NULL,
	`contact_name` text NOT NULL,
	`phone` text NOT NULL,
	`zone` text,
	`password_hash` text,
	`password_salt` text,
	`commission_cents` integer,
	`balance_cap_cents` integer DEFAULT 500000 NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`isp_id`) REFERENCES `isps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stores_phone_unique` ON `stores` (`phone`);--> statement-breakpoint
CREATE INDEX `stores_isp_idx` ON `stores` (`isp_id`);