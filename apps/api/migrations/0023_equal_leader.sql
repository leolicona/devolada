ALTER TABLE `businesses` ADD `tolerance_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `over_treatment` text DEFAULT 'flag' NOT NULL;