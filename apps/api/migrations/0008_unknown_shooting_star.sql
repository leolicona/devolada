CREATE TABLE `customer_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`isp_id` text NOT NULL,
	`wisphub_customer_id` text NOT NULL,
	`phone` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`isp_id`) REFERENCES `isps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_contacts_isp_customer_idx` ON `customer_contacts` (`isp_id`,`wisphub_customer_id`);