ALTER TABLE `isps` DROP COLUMN `email_verified`;--> statement-breakpoint
ALTER TABLE `isps` DROP COLUMN `password_hash`;--> statement-breakpoint
ALTER TABLE `isps` DROP COLUMN `password_salt`;--> statement-breakpoint
ALTER TABLE `stores` DROP COLUMN `password_hash`;--> statement-breakpoint
ALTER TABLE `stores` DROP COLUMN `password_salt`;