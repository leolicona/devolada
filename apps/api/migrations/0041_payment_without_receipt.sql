-- payment-without-receipt (specs/012-payment-without-receipt/data-model.md):
-- a payer's reference beside the link, never on it — `payer_references`,
-- a person's seven digits unique per business for ever (D1, D3, D6, D26),
-- and `payer_reference_customers`, which customers hold it (D1, D4, D5);
-- `provider_quota`, the provider's remaining calls as a platform row
-- (D19); the per-business switch `businesses.pay_by_reference` (D20); and
-- on `payments` the confirmation's path, its rounds and corrections, the
-- clave's last four characters and what the page offered
-- (reference_source, ladder_round, correction_count, clave_tail,
-- confirmation — D8, D14, D16, D17, D23).
-- Additive only: CREATE TABLE, CREATE INDEX, ADD COLUMN. Rows before it
-- read NULL or 0 and run as they always did; with the switch off (the
-- default) no path reads a new column.
CREATE TABLE `payer_reference_customers` (
	`business_id` text NOT NULL,
	`reference_id` text NOT NULL,
	`source` text NOT NULL,
	`customer_key` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`business_id`, `source`, `customer_key`),
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reference_id`) REFERENCES `payer_references`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payer_reference_customers_reference_idx` ON `payer_reference_customers` (`reference_id`);--> statement-breakpoint
CREATE TABLE `payer_references` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`digits` text NOT NULL,
	`origin` text NOT NULL,
	`previous_reference_id` text,
	`transition_ends_at` integer,
	`created_at` integer NOT NULL,
	`changed_at` integer,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payer_references_business_digits_idx` ON `payer_references` (`business_id`,`digits`);--> statement-breakpoint
CREATE TABLE `provider_quota` (
	`provider` text PRIMARY KEY NOT NULL,
	`remaining` integer NOT NULL,
	`observed_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `businesses` ADD `pay_by_reference` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `reference_source` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `ladder_round` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `correction_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `clave_tail` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `confirmation` text;