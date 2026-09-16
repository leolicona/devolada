CREATE TABLE `extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text,
	`source` text NOT NULL,
	`outcome` text NOT NULL,
	`model` text,
	`proof_sha256` text,
	`media_type` text,
	`byte_size` integer,
	`tracking_key` text,
	`sender_bank` text,
	`amount_cents` integer,
	`transfer_date` text,
	`receipt_status` text,
	`gate_tracking_key` text,
	`gate_sender_bank` text,
	`shape` text,
	`suggested_bank` text,
	`raw_output` text,
	`validation_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`validation_id`) REFERENCES `validations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `extractions_business_idx` ON `extractions` (`business_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `validations` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text,
	`mode` text NOT NULL,
	`status` text,
	`reason` text,
	`already_validated` integer DEFAULT false NOT NULL,
	`tracking_key` text,
	`sender_bank` text,
	`reference_number` text,
	`amount_cents` integer,
	`transfer_date` text,
	`beneficiary_bank` text,
	`provider_validation_id` text,
	`cep_status` text,
	`provider_http_status` integer,
	`provider_ms` integer,
	`quota_remaining` integer,
	`customer_ref` text,
	`payment_ref` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `validations_business_idx` ON `validations` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `validations_customer_idx` ON `validations` (`business_id`,`customer_ref`);