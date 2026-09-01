CREATE TABLE `credit_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`kind` text NOT NULL,
	`cents` integer NOT NULL,
	`payment_id` text,
	`top_up_id` text,
	`granted_to_user_id` text,
	`reason` text,
	`author_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`top_up_id`) REFERENCES `top_ups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_to_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `credit_entries_business_created_idx` ON `credit_entries` (`business_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_entries_fee_payment_idx` ON `credit_entries` (`payment_id`) WHERE kind = 'validation_fee';--> statement-breakpoint
CREATE UNIQUE INDEX `credit_entries_bonus_user_idx` ON `credit_entries` (`granted_to_user_id`) WHERE kind = 'welcome_bonus';--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`author_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `platform_settings_key_created_idx` ON `platform_settings` (`key`,`created_at`);--> statement-breakpoint
CREATE TABLE `top_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`submitted_by_user_id` text NOT NULL,
	`claimed_cents` integer NOT NULL,
	`credited_cents` integer,
	`status` text DEFAULT 'validating' NOT NULL,
	`proof_mode` text NOT NULL,
	`tracking_key` text,
	`sender_bank` text,
	`transfer_date` text,
	`proof_key` text,
	`reading_check` text,
	`consta_validation_id` text,
	`consta_status` text,
	`validation_attempts` integer DEFAULT 0 NOT NULL,
	`next_validation_at` integer,
	`last_error` text,
	`confirmed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `top_ups_business_created_idx` ON `top_ups` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `top_ups_due_idx` ON `top_ups` (`status`,`next_validation_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `top_ups_tracking_idx` ON `top_ups` (`tracking_key`) WHERE tracking_key IS NOT NULL AND status NOT IN ('invalid', 'expired', 'superseded');--> statement-breakpoint
ALTER TABLE `businesses` ADD `fee_override_cents` integer;