CREATE TABLE `direct_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_link_id` text NOT NULL,
	`isp_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`monthly_fee_cents` integer NOT NULL,
	`service_fee_cents` integer NOT NULL,
	`status` text DEFAULT 'validating' NOT NULL,
	`proof_mode` text NOT NULL,
	`tracking_key` text,
	`sender_bank` text,
	`transfer_date` text,
	`proof_key` text,
	`consta_validation_id` text,
	`consta_status` text,
	`charge_id` text,
	`validation_attempts` integer DEFAULT 0 NOT NULL,
	`next_validation_at` integer,
	`last_error` text,
	`confirmed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payment_link_id`) REFERENCES `payment_links`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`isp_id`) REFERENCES `isps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`charge_id`) REFERENCES `charges`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `direct_payments_link_idx` ON `direct_payments` (`payment_link_id`);--> statement-breakpoint
CREATE INDEX `direct_payments_due_idx` ON `direct_payments` (`status`,`next_validation_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `direct_payments_isp_tracking_idx` ON `direct_payments` (`isp_id`,`tracking_key`) WHERE tracking_key IS NOT NULL AND status NOT IN ('invalid', 'expired');--> statement-breakpoint
CREATE TABLE `payment_links` (
	`id` text PRIMARY KEY NOT NULL,
	`isp_id` text NOT NULL,
	`token` text NOT NULL,
	`wisphub_customer_id` text NOT NULL,
	`customer_usuario` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`isp_id`) REFERENCES `isps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_links_token_unique` ON `payment_links` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_links_isp_customer_idx` ON `payment_links` (`isp_id`,`wisphub_customer_id`);--> statement-breakpoint
PRAGMA defer_foreign_keys = true;--> statement-breakpoint
CREATE TABLE `__new_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`isp_id` text NOT NULL,
	`store_id` text,
	`channel` text DEFAULT 'store' NOT NULL,
	`direct_payment_id` text,
	`folio` text NOT NULL,
	`wisphub_customer_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_zone` text,
	`customer_phone` text,
	`monthly_fee_cents` integer NOT NULL,
	`service_fee_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`reconnection_status` text DEFAULT 'queued' NOT NULL,
	`reconnection_attempts` integer DEFAULT 0 NOT NULL,
	`reconnected_at` integer,
	`wisphub_invoice_id` integer,
	`next_attempt_at` integer,
	`last_error` text,
	`customer_usuario` text,
	`payment_registered_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`isp_id`) REFERENCES `isps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`direct_payment_id`) REFERENCES `direct_payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_charges`("id", "isp_id", "store_id", "channel", "direct_payment_id", "folio", "wisphub_customer_id", "customer_name", "customer_zone", "customer_phone", "monthly_fee_cents", "service_fee_cents", "total_cents", "reconnection_status", "reconnection_attempts", "reconnected_at", "wisphub_invoice_id", "next_attempt_at", "last_error", "customer_usuario", "payment_registered_at", "created_at") SELECT "id", "isp_id", "store_id", 'store', NULL, "folio", "wisphub_customer_id", "customer_name", "customer_zone", "customer_phone", "monthly_fee_cents", "service_fee_cents", "total_cents", "reconnection_status", "reconnection_attempts", "reconnected_at", "wisphub_invoice_id", "next_attempt_at", "last_error", "customer_usuario", "payment_registered_at", "created_at" FROM `charges`;--> statement-breakpoint
DROP TABLE `charges`;--> statement-breakpoint
ALTER TABLE `__new_charges` RENAME TO `charges`;--> statement-breakpoint
CREATE UNIQUE INDEX `charges_folio_unique` ON `charges` (`folio`);--> statement-breakpoint
CREATE INDEX `charges_store_idx` ON `charges` (`store_id`);--> statement-breakpoint
CREATE INDEX `charges_isp_created_idx` ON `charges` (`isp_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `charges_due_idx` ON `charges` (`reconnection_status`,`next_attempt_at`);--> statement-breakpoint
ALTER TABLE `isps` ADD `spei_clabe` text;--> statement-breakpoint
ALTER TABLE `isps` ADD `spei_bank` text;--> statement-breakpoint
ALTER TABLE `isps` ADD `spei_beneficiary_name` text;--> statement-breakpoint
ALTER TABLE `isps` ADD `spei_service_fee_cents` integer;