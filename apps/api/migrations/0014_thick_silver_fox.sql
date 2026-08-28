CREATE TABLE `proof_rejections` (
	`id` text PRIMARY KEY NOT NULL,
	`isp_id` text NOT NULL,
	`payment_link_id` text NOT NULL,
	`owner_payment_id` text,
	`tracking_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`isp_id`) REFERENCES `isps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_link_id`) REFERENCES `payment_links`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_payment_id`) REFERENCES `direct_payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `proof_rejections_link_idx` ON `proof_rejections` (`payment_link_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `direct_payments` ADD `provisional_release_at` integer;--> statement-breakpoint
ALTER TABLE `direct_payments` ADD `release_evidence` text;--> statement-breakpoint
ALTER TABLE `isps` ADD `provisional_release_enabled` integer DEFAULT false NOT NULL;