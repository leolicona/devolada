CREATE TABLE `store_handovers` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`business_id` text NOT NULL,
	`cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text,
	`declared_by_user_id` text NOT NULL,
	`declared_at` integer NOT NULL,
	`resolved_by_user_id` text,
	`resolved_at` integer,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`declared_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `store_handovers_business_status_idx` ON `store_handovers` (`business_id`,`status`,`declared_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `store_handovers_pending_idx` ON `store_handovers` (`store_id`,`business_id`) WHERE status = 'pending';--> statement-breakpoint
CREATE TABLE `store_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_invitations_token_hash_unique` ON `store_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `store_invitations_store_status_idx` ON `store_invitations` (`store_id`,`status`);--> statement-breakpoint
CREATE TABLE `store_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`business_id` text NOT NULL,
	`kind` text NOT NULL,
	`cents` integer NOT NULL,
	`payment_id` text,
	`handover_id` text,
	`reason` text,
	`author_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`handover_id`) REFERENCES `store_handovers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `store_ledger_store_business_created_idx` ON `store_ledger` (`store_id`,`business_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `store_ledger_collection_payment_idx` ON `store_ledger` (`payment_id`) WHERE kind = 'collection';--> statement-breakpoint
CREATE UNIQUE INDEX `store_ledger_handover_idx` ON `store_ledger` (`handover_id`) WHERE kind = 'handover';--> statement-breakpoint
CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`shopkeeper_name` text NOT NULL,
	`phone` text NOT NULL,
	`user_id` text,
	`status` text DEFAULT 'invited' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stores_phone_unique` ON `stores` (`phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `stores_user_id_unique` ON `stores` (`user_id`);--> statement-breakpoint
ALTER TABLE `businesses` ADD `store_channel_on` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `store_channel_since` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `store_id` text REFERENCES stores(id);--> statement-breakpoint
ALTER TABLE `payments` ADD `store_user_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `payments` ADD `store_fee_cents` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `collection_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `payments_store_collection_key_idx` ON `payments` (`store_id`,`collection_key`) WHERE collection_key IS NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `username` text;--> statement-breakpoint
ALTER TABLE `user` ADD `display_username` text;--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);