CREATE TABLE `extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`api_key_id` text NOT NULL,
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
	`raw_output` text,
	`validation_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`validation_id`) REFERENCES `validations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `extractions_key_idx` ON `extractions` (`api_key_id`,`created_at`);