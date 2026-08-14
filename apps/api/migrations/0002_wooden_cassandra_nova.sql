ALTER TABLE `charges` ADD `wisphub_invoice_id` integer;--> statement-breakpoint
ALTER TABLE `charges` ADD `next_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `charges` ADD `last_error` text;--> statement-breakpoint
CREATE INDEX `charges_due_idx` ON `charges` (`reconnection_status`,`next_attempt_at`);