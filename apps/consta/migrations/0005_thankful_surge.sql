ALTER TABLE `validations` ADD `customer_ref` text;--> statement-breakpoint
ALTER TABLE `validations` ADD `payment_ref` text;--> statement-breakpoint
CREATE INDEX `validations_customer_idx` ON `validations` (`api_key_id`,`customer_ref`);