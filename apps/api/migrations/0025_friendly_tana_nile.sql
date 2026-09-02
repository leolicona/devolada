ALTER TABLE `payments` RENAME COLUMN "reconnection_status" TO "action_outcome";--> statement-breakpoint
ALTER TABLE `payments` RENAME COLUMN "reconnection_attempts" TO "action_attempts";--> statement-breakpoint
ALTER TABLE `payments` RENAME COLUMN "reconnected_at" TO "action_done_at";--> statement-breakpoint
ALTER TABLE `payments` RENAME COLUMN "reconnection_error" TO "action_error";--> statement-breakpoint
UPDATE `payments` SET `action_outcome` = 'done' WHERE `action_outcome` = 'reconnected';--> statement-breakpoint
CREATE TABLE `integration_events` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`class` text NOT NULL,
	`action` text NOT NULL,
	`status` text DEFAULT 'dispatched' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`acked_at` integer,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `integration_events_business_idx` ON `integration_events` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `integration_events_payment_idx` ON `integration_events` (`payment_id`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`provider` text DEFAULT 'wisphub' NOT NULL,
	`api_key` text,
	`exact_action` text DEFAULT 'register_and_reconnect' NOT NULL,
	`short_action` text DEFAULT 'register_and_reconnect' NOT NULL,
	`over_action` text DEFAULT 'register_and_reconnect' NOT NULL,
	`threshold_percent` integer DEFAULT 100 NOT NULL,
	`floor_cents` integer DEFAULT 0 NOT NULL,
	`provisional_release_enabled` integer DEFAULT false NOT NULL,
	`actions_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_business_idx` ON `integrations` (`business_id`);--> statement-breakpoint
INSERT INTO `integrations` (`id`, `business_id`, `provider`, `api_key`, `threshold_percent`, `floor_cents`, `provisional_release_enabled`, `actions_enabled`, `created_at`)
SELECT lower(hex(randomblob(16))), `id`, 'wisphub', `wisphub_api_key`, `reconnection_threshold_percent`, `reconnection_floor_cents`, `provisional_release_enabled`, true, (strftime('%s','now') * 1000)
FROM `businesses` WHERE `wisphub_api_key` IS NOT NULL;--> statement-breakpoint
DROP INDEX `payments_reconnection_due_idx`;--> statement-breakpoint
ALTER TABLE `payments` ADD `observed_action` text;--> statement-breakpoint
CREATE INDEX `payments_action_due_idx` ON `payments` (`action_outcome`,`next_attempt_at`);--> statement-breakpoint
ALTER TABLE `businesses` DROP COLUMN `wisphub_api_key`;--> statement-breakpoint
ALTER TABLE `businesses` DROP COLUMN `reconnection_threshold_percent`;--> statement-breakpoint
ALTER TABLE `businesses` DROP COLUMN `reconnection_floor_cents`;--> statement-breakpoint
ALTER TABLE `businesses` DROP COLUMN `provisional_release_enabled`;