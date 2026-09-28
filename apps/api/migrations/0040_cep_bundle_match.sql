-- cep-bundle-match (specs/013-cep-bundle-match/data-model.md): the two
-- tables a search without a clave fills — `cep_bundles`, one per provider
-- answer that linked a bundle of CEPs (D1, D5, D16), and `cep_records`,
-- one per transfer such a search returned, unique per business and clave
-- (D4, D5) — plus the receipt's side of a match and how it was decided on
-- `payments` (transfer_time, sender_tail, match_trail, match_distance_s —
-- D6, D8, D15) and the reader's sender tail on `extractions` (D15).
-- Additive only: CREATE TABLE, CREATE INDEX, ADD COLUMN. Rows before it
-- keep NULL and run as they always did. `validations.reason` gains
-- `several` in TypeScript only; SQLite keeps text.
CREATE TABLE `cep_bundles` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`payment_ref` text NOT NULL,
	`validation_id` text,
	`source` text DEFAULT 'apicep' NOT NULL,
	`reference_number` text,
	`transfer_date` text,
	`sender_bank` text,
	`amount_cents` integer,
	`beneficiary` text,
	`status` text NOT NULL,
	`download_attempts` integer DEFAULT 0 NOT NULL,
	`url` text,
	`claves` text,
	`unreadable` text,
	`sha256` text,
	`r2_key` text,
	`byte_size` integer,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`validation_id`) REFERENCES `validations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cep_bundles_business_payment_idx` ON `cep_bundles` (`business_id`,`payment_ref`);--> statement-breakpoint
CREATE TABLE `cep_records` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`clave` text NOT NULL,
	`bundle_id` text,
	`operation_date` text NOT NULL,
	`credit_date` text NOT NULL,
	`credit_time` text NOT NULL,
	`credited_at` integer NOT NULL,
	`sender_bank` text NOT NULL,
	`sender_account_type` text NOT NULL,
	`sender_account` text NOT NULL,
	`receiver_spei_code` text NOT NULL,
	`receiver_account_type` text NOT NULL,
	`receiver_account` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`certificate_number` text NOT NULL,
	`seal` text NOT NULL,
	`seal_status` text DEFAULT 'not_verified' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bundle_id`) REFERENCES `cep_bundles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cep_records_business_clave_idx` ON `cep_records` (`business_id`,`clave`);--> statement-breakpoint
CREATE INDEX `cep_records_business_day_amount_idx` ON `cep_records` (`business_id`,`credit_date`,`amount_cents`);--> statement-breakpoint
ALTER TABLE `extractions` ADD `sender_tail` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `transfer_time` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `sender_tail` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `match_trail` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `match_distance_s` integer;