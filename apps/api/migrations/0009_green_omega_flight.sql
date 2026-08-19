DROP INDEX `direct_payments_isp_tracking_idx`;--> statement-breakpoint
ALTER TABLE `direct_payments` ADD `receipt_status` text;--> statement-breakpoint
ALTER TABLE `direct_payments` ADD `cep_sender_name` text;--> statement-breakpoint
ALTER TABLE `direct_payments` ADD `supersedes_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `direct_payments_isp_tracking_idx` ON `direct_payments` (`isp_id`,`tracking_key`) WHERE tracking_key IS NOT NULL AND status NOT IN ('invalid', 'expired', 'superseded');