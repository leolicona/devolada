CREATE TABLE `access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`whatsapp` text NOT NULL,
	`name` text,
	`billing_system` text,
	`form` text NOT NULL,
	`channel` text DEFAULT 'direct' NOT NULL,
	`created_at` integer NOT NULL,
	`notified_at` integer,
	`notify_error` text
);
--> statement-breakpoint
CREATE INDEX `access_requests_created_idx` ON `access_requests` (`created_at`);--> statement-breakpoint
CREATE TABLE `landing_counts` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`channel` text NOT NULL,
	`step` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `landing_counts_day_channel_step_idx` ON `landing_counts` (`day`,`channel`,`step`);