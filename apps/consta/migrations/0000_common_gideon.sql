CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `validations` (
	`id` text PRIMARY KEY NOT NULL,
	`api_key_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`already_validated` integer DEFAULT false NOT NULL,
	`tracking_key` text,
	`reference_number` text,
	`amount_cents` integer,
	`transfer_date` text,
	`provider_validation_id` text,
	`cep_status` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `validations_key_idx` ON `validations` (`api_key_id`,`created_at`);