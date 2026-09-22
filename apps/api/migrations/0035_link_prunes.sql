CREATE TABLE `link_prunes` (
	`business_id` text PRIMARY KEY NOT NULL,
	`ran_at` integer NOT NULL,
	`deleted_count` integer DEFAULT 0 NOT NULL,
	`notice_seen` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
