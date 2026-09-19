CREATE TABLE `wisphub_pending_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`pass_id` text NOT NULL,
	`page` integer NOT NULL,
	`rows` text NOT NULL,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wisphub_pending_pages_pass_idx` ON `wisphub_pending_pages` (`business_id`,`pass_id`,`page`);--> statement-breakpoint
CREATE TABLE `wisphub_pending_sweeps` (
	`business_id` text PRIMARY KEY NOT NULL,
	`base_url` text NOT NULL,
	`served_pass_id` text,
	`served_pages` integer,
	`served_started_at` integer,
	`served_finished_at` integer,
	`live_pass_id` text,
	`live_cursor` text,
	`live_pages` integer DEFAULT 0 NOT NULL,
	`live_started_at` integer,
	`rest_until` integer,
	`claimed_until` integer,
	`last_error` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
