ALTER TABLE `direct_payments` ADD `received_cents` integer;--> statement-breakpoint
ALTER TABLE `isps` ADD `reconnection_threshold_percent` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `isps` ADD `reconnection_floor_cents` integer DEFAULT 0 NOT NULL;