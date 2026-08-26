PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_validations` (
	`id` text PRIMARY KEY NOT NULL,
	`api_key_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text,
	`reason` text,
	`already_validated` integer DEFAULT false NOT NULL,
	`tracking_key` text,
	`reference_number` text,
	`amount_cents` integer,
	`transfer_date` text,
	`provider_validation_id` text,
	`cep_status` text,
	`provider_http_status` integer,
	`provider_ms` integer,
	`quota_remaining` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_validations`("id", "api_key_id", "mode", "status", "reason", "already_validated", "tracking_key", "reference_number", "amount_cents", "transfer_date", "provider_validation_id", "cep_status", "provider_http_status", "provider_ms", "quota_remaining", "created_at") SELECT "id", "api_key_id", "mode", "status", "reason", "already_validated", "tracking_key", "reference_number", "amount_cents", "transfer_date", "provider_validation_id", "cep_status", NULL, NULL, NULL, "created_at" FROM `validations`;--> statement-breakpoint
DROP TABLE `validations`;--> statement-breakpoint
ALTER TABLE `__new_validations` RENAME TO `validations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `validations_key_idx` ON `validations` (`api_key_id`,`created_at`);