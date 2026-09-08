-- Phase 2 foundation (docs/legacy/business/business-and-memberships.spec.md D6, D7).
--> statement-breakpoint
PRAGMA defer_foreign_keys = true;
--> statement-breakpoint
-- D1 ignores PRAGMA foreign_keys inside a migration (batch = transaction);
-- `defer_foreign_keys` is the D1 way (precedent: 0007). Hand-ordered from
-- drizzle-kit's output: the plugin tables first, then the
--> statement-breakpoint
-- tenant rename with the D7 backfill in three steps (org_id nullable →
--> statement-breakpoint
-- one organization + one owner membership per business → NOT NULL, user_id
--> statement-breakpoint
-- dropped), then the business_id renames and the store-era drops.
--> statement-breakpoint
-- 1. organizations plugin (organization, member, invitation) + session field
--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);
--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `session` ADD `active_organization_id` text;
--> statement-breakpoint
DROP INDEX `user_username_unique`;
--> statement-breakpoint
ALTER TABLE `user` DROP COLUMN `username`;
--> statement-breakpoint
ALTER TABLE `user` DROP COLUMN `display_username`;
--> statement-breakpoint
-- 2. the tenant: isps → businesses, with the auth twin backfilled (D7)
--> statement-breakpoint
ALTER TABLE `isps` RENAME TO `businesses`;
--> statement-breakpoint
ALTER TABLE `businesses` ADD `org_id` text;
--> statement-breakpoint
UPDATE `businesses` SET `org_id` = 'org_' || `id`;
--> statement-breakpoint
INSERT INTO `organization` (`id`, `name`, `slug`, `created_at`) SELECT `org_id`, `name`, 'negocio-' || `id`, strftime('%s','now') FROM `businesses`;
--> statement-breakpoint
INSERT INTO `member` (`id`, `organization_id`, `user_id`, `role`, `created_at`) SELECT 'mem_' || `id`, `org_id`, `user_id`, 'owner', strftime('%s','now') FROM `businesses` WHERE `user_id` IS NOT NULL;
--> statement-breakpoint
-- 3. rebuild businesses: org_id NOT NULL; user_id and store_commission_cents gone
--> statement-breakpoint
-- rebuild businesses (0007 pattern: copy → drop → recreate under its own name → refill, so the deferred FK counter settles)
--> statement-breakpoint
CREATE TABLE `__copy_businesses` (
	`id` text,
	`org_id` text,
	`name` text,
	`email` text,
	`wisphub_api_key` text,
	`service_fee_cents` integer,
	`timezone` text,
	`time_format` text,
	`status` text,
	`spei_clabe` text,
	`spei_bank` text,
	`spei_beneficiary_name` text,
	`spei_service_fee_cents` integer,
	`reconnection_threshold_percent` integer,
	`reconnection_floor_cents` integer,
	`provisional_release_enabled` integer,
	`created_at` integer
);
--> statement-breakpoint
INSERT INTO `__copy_businesses` SELECT "id", "org_id", "name", "email", "wisphub_api_key", "service_fee_cents", "timezone", "time_format", "status", "spei_clabe", "spei_bank", "spei_beneficiary_name", "spei_service_fee_cents", "reconnection_threshold_percent", "reconnection_floor_cents", "provisional_release_enabled", "created_at" FROM `businesses`;
--> statement-breakpoint
DROP TABLE `businesses`;
--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`wisphub_api_key` text,
	`service_fee_cents` integer DEFAULT 1500 NOT NULL,
	`timezone` text DEFAULT 'America/Mexico_City' NOT NULL,
	`time_format` text DEFAULT '12h' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`spei_clabe` text,
	`spei_bank` text,
	`spei_beneficiary_name` text,
	`spei_service_fee_cents` integer,
	`reconnection_threshold_percent` integer DEFAULT 100 NOT NULL,
	`reconnection_floor_cents` integer DEFAULT 0 NOT NULL,
	`provisional_release_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `businesses`("id", "org_id", "name", "email", "wisphub_api_key", "service_fee_cents", "timezone", "time_format", "status", "spei_clabe", "spei_bank", "spei_beneficiary_name", "spei_service_fee_cents", "reconnection_threshold_percent", "reconnection_floor_cents", "provisional_release_enabled", "created_at") SELECT "id", "org_id", "name", "email", "wisphub_api_key", "service_fee_cents", "timezone", "time_format", "status", "spei_clabe", "spei_bank", "spei_beneficiary_name", "spei_service_fee_cents", "reconnection_threshold_percent", "reconnection_floor_cents", "provisional_release_enabled", "created_at" FROM `__copy_businesses`;
--> statement-breakpoint
DROP TABLE `__copy_businesses`;
--> statement-breakpoint
CREATE UNIQUE INDEX `businesses_org_id_unique` ON `businesses` (`org_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `businesses_email_unique` ON `businesses` (`email`);
--> statement-breakpoint
-- 4. business_id on every tenant-scoped table (rebuilds keep drizzle's index names)
--> statement-breakpoint
ALTER TABLE `direct_payments` RENAME COLUMN `isp_id` TO `business_id`;
--> statement-breakpoint
DROP INDEX IF EXISTS `direct_payments_link_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `direct_payments_due_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `direct_payments_isp_tracking_idx`;
--> statement-breakpoint
-- rebuild direct_payments (0007 pattern: copy → drop → recreate under its own name → refill, so the deferred FK counter settles)
--> statement-breakpoint
CREATE TABLE `__copy_direct_payments` (
	`id` text,
	`payment_link_id` text,
	`business_id` text,
	`amount_cents` integer,
	`invoice_cents` integer,
	`carried_balance_cents` integer,
	`received_cents` integer,
	`claimed_amount_cents` integer,
	`reading_check` text,
	`disputed_fields` text,
	`service_fee_cents` integer,
	`status` text,
	`proof_mode` text,
	`tracking_key` text,
	`sender_bank` text,
	`transfer_date` text,
	`proof_key` text,
	`receipt_status` text,
	`cep_sender_name` text,
	`supersedes_id` text,
	`consta_validation_id` text,
	`consta_status` text,
	`charge_id` text,
	`validation_attempts` integer,
	`next_validation_at` integer,
	`last_error` text,
	`confirmed_at` integer,
	`provisional_release_at` integer,
	`release_evidence` text,
	`release_kind` text,
	`trust_snapshot` text,
	`created_at` integer
);
--> statement-breakpoint
INSERT INTO `__copy_direct_payments` SELECT "id", "payment_link_id", "business_id", "amount_cents", "invoice_cents", "carried_balance_cents", "received_cents", "claimed_amount_cents", "reading_check", "disputed_fields", "service_fee_cents", "status", "proof_mode", "tracking_key", "sender_bank", "transfer_date", "proof_key", "receipt_status", "cep_sender_name", "supersedes_id", "consta_validation_id", "consta_status", "charge_id", "validation_attempts", "next_validation_at", "last_error", "confirmed_at", "provisional_release_at", "release_evidence", "release_kind", "trust_snapshot", "created_at" FROM `direct_payments`;
--> statement-breakpoint
DROP TABLE `direct_payments`;
--> statement-breakpoint
CREATE TABLE `direct_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_link_id` text NOT NULL,
	`business_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`invoice_cents` integer NOT NULL,
	`carried_balance_cents` integer DEFAULT 0 NOT NULL,
	`received_cents` integer,
	`claimed_amount_cents` integer,
	`reading_check` text,
	`disputed_fields` text,
	`service_fee_cents` integer NOT NULL,
	`status` text DEFAULT 'validating' NOT NULL,
	`proof_mode` text NOT NULL,
	`tracking_key` text,
	`sender_bank` text,
	`transfer_date` text,
	`proof_key` text,
	`receipt_status` text,
	`cep_sender_name` text,
	`supersedes_id` text,
	`consta_validation_id` text,
	`consta_status` text,
	`charge_id` text,
	`validation_attempts` integer DEFAULT 0 NOT NULL,
	`next_validation_at` integer,
	`last_error` text,
	`confirmed_at` integer,
	`provisional_release_at` integer,
	`release_evidence` text,
	`release_kind` text,
	`trust_snapshot` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payment_link_id`) REFERENCES `payment_links`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`charge_id`) REFERENCES `charges`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `direct_payments`("id", "payment_link_id", "business_id", "amount_cents", "invoice_cents", "carried_balance_cents", "received_cents", "claimed_amount_cents", "reading_check", "disputed_fields", "service_fee_cents", "status", "proof_mode", "tracking_key", "sender_bank", "transfer_date", "proof_key", "receipt_status", "cep_sender_name", "supersedes_id", "consta_validation_id", "consta_status", "charge_id", "validation_attempts", "next_validation_at", "last_error", "confirmed_at", "provisional_release_at", "release_evidence", "release_kind", "trust_snapshot", "created_at") SELECT "id", "payment_link_id", "business_id", "amount_cents", "invoice_cents", "carried_balance_cents", "received_cents", "claimed_amount_cents", "reading_check", "disputed_fields", "service_fee_cents", "status", "proof_mode", "tracking_key", "sender_bank", "transfer_date", "proof_key", "receipt_status", "cep_sender_name", "supersedes_id", "consta_validation_id", "consta_status", "charge_id", "validation_attempts", "next_validation_at", "last_error", "confirmed_at", "provisional_release_at", "release_evidence", "release_kind", "trust_snapshot", "created_at" FROM `__copy_direct_payments`;
--> statement-breakpoint
DROP TABLE `__copy_direct_payments`;
--> statement-breakpoint
CREATE INDEX `direct_payments_link_idx` ON `direct_payments` (`payment_link_id`);
--> statement-breakpoint
CREATE INDEX `direct_payments_due_idx` ON `direct_payments` (`status`,`next_validation_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `direct_payments_isp_tracking_idx` ON `direct_payments` (`business_id`,`tracking_key`) WHERE tracking_key IS NOT NULL AND status NOT IN ('invalid', 'expired', 'superseded');
--> statement-breakpoint
ALTER TABLE `proof_rejections` RENAME COLUMN `isp_id` TO `business_id`;
--> statement-breakpoint
DROP INDEX IF EXISTS `proof_rejections_link_idx`;
--> statement-breakpoint
-- rebuild proof_rejections (0007 pattern: copy → drop → recreate under its own name → refill, so the deferred FK counter settles)
--> statement-breakpoint
CREATE TABLE `__copy_proof_rejections` (
	`id` text,
	`business_id` text,
	`payment_link_id` text,
	`owner_payment_id` text,
	`tracking_key` text,
	`created_at` integer
);
--> statement-breakpoint
INSERT INTO `__copy_proof_rejections` SELECT "id", "business_id", "payment_link_id", "owner_payment_id", "tracking_key", "created_at" FROM `proof_rejections`;
--> statement-breakpoint
DROP TABLE `proof_rejections`;
--> statement-breakpoint
CREATE TABLE `proof_rejections` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`payment_link_id` text NOT NULL,
	`owner_payment_id` text,
	`tracking_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_link_id`) REFERENCES `payment_links`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_payment_id`) REFERENCES `direct_payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `proof_rejections`("id", "business_id", "payment_link_id", "owner_payment_id", "tracking_key", "created_at") SELECT "id", "business_id", "payment_link_id", "owner_payment_id", "tracking_key", "created_at" FROM `__copy_proof_rejections`;
--> statement-breakpoint
DROP TABLE `__copy_proof_rejections`;
--> statement-breakpoint
CREATE INDEX `proof_rejections_link_idx` ON `proof_rejections` (`payment_link_id`,`created_at`);
--> statement-breakpoint
ALTER TABLE `charges` RENAME COLUMN `isp_id` TO `business_id`;
--> statement-breakpoint
DROP INDEX IF EXISTS `charges_store_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `charges_isp_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `charges_due_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `charges_folio_unique`;
--> statement-breakpoint
-- rebuild charges (0007 pattern: copy → drop → recreate under its own name → refill, so the deferred FK counter settles)
--> statement-breakpoint
CREATE TABLE `__copy_charges` (
	`id` text,
	`business_id` text,
	`channel` text,
	`direct_payment_id` text,
	`folio` text,
	`wisphub_customer_id` text,
	`customer_name` text,
	`customer_zone` text,
	`customer_phone` text,
	`invoice_cents` integer,
	`carried_balance_cents` integer,
	`service_fee_cents` integer,
	`total_cents` integer,
	`reconnection_status` text,
	`reconnection_attempts` integer,
	`reconnected_at` integer,
	`wisphub_invoice_id` integer,
	`next_attempt_at` integer,
	`last_error` text,
	`customer_usuario` text,
	`payment_registered_at` integer,
	`created_at` integer
);
--> statement-breakpoint
INSERT INTO `__copy_charges` SELECT "id", "business_id", "channel", "direct_payment_id", "folio", "wisphub_customer_id", "customer_name", "customer_zone", "customer_phone", "invoice_cents", "carried_balance_cents", "service_fee_cents", "total_cents", "reconnection_status", "reconnection_attempts", "reconnected_at", "wisphub_invoice_id", "next_attempt_at", "last_error", "customer_usuario", "payment_registered_at", "created_at" FROM `charges`;
--> statement-breakpoint
DROP TABLE `charges`;
--> statement-breakpoint
CREATE TABLE `charges` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`channel` text DEFAULT 'spei' NOT NULL,
	`direct_payment_id` text,
	`folio` text NOT NULL,
	`wisphub_customer_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_zone` text,
	`customer_phone` text,
	`invoice_cents` integer NOT NULL,
	`carried_balance_cents` integer DEFAULT 0 NOT NULL,
	`service_fee_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`reconnection_status` text DEFAULT 'queued' NOT NULL,
	`reconnection_attempts` integer DEFAULT 0 NOT NULL,
	`reconnected_at` integer,
	`wisphub_invoice_id` integer,
	`next_attempt_at` integer,
	`last_error` text,
	`customer_usuario` text,
	`payment_registered_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`direct_payment_id`) REFERENCES `direct_payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `charges`("id", "business_id", "channel", "direct_payment_id", "folio", "wisphub_customer_id", "customer_name", "customer_zone", "customer_phone", "invoice_cents", "carried_balance_cents", "service_fee_cents", "total_cents", "reconnection_status", "reconnection_attempts", "reconnected_at", "wisphub_invoice_id", "next_attempt_at", "last_error", "customer_usuario", "payment_registered_at", "created_at") SELECT "id", "business_id", "channel", "direct_payment_id", "folio", "wisphub_customer_id", "customer_name", "customer_zone", "customer_phone", "invoice_cents", "carried_balance_cents", "service_fee_cents", "total_cents", "reconnection_status", "reconnection_attempts", "reconnected_at", "wisphub_invoice_id", "next_attempt_at", "last_error", "customer_usuario", "payment_registered_at", "created_at" FROM `__copy_charges`;
--> statement-breakpoint
DROP TABLE `__copy_charges`;
--> statement-breakpoint
CREATE UNIQUE INDEX `charges_folio_unique` ON `charges` (`folio`);
--> statement-breakpoint
CREATE INDEX `charges_business_created_idx` ON `charges` (`business_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `charges_due_idx` ON `charges` (`reconnection_status`,`next_attempt_at`);
--> statement-breakpoint
ALTER TABLE `payment_links` RENAME COLUMN `isp_id` TO `business_id`;
--> statement-breakpoint
DROP INDEX IF EXISTS `payment_links_isp_usuario_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `payment_links_token_unique`;
--> statement-breakpoint
-- rebuild payment_links (0007 pattern: copy → drop → recreate under its own name → refill, so the deferred FK counter settles)
--> statement-breakpoint
CREATE TABLE `__copy_payment_links` (
	`id` text,
	`business_id` text,
	`token` text,
	`wisphub_customer_id` text,
	`customer_usuario` text,
	`created_at` integer
);
--> statement-breakpoint
INSERT INTO `__copy_payment_links` SELECT "id", "business_id", "token", "wisphub_customer_id", "customer_usuario", "created_at" FROM `payment_links`;
--> statement-breakpoint
DROP TABLE `payment_links`;
--> statement-breakpoint
CREATE TABLE `payment_links` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`token` text NOT NULL,
	`wisphub_customer_id` text NOT NULL,
	`customer_usuario` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `payment_links`("id", "business_id", "token", "wisphub_customer_id", "customer_usuario", "created_at") SELECT "id", "business_id", "token", "wisphub_customer_id", "customer_usuario", "created_at" FROM `__copy_payment_links`;
--> statement-breakpoint
DROP TABLE `__copy_payment_links`;
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_links_token_unique` ON `payment_links` (`token`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_links_business_usuario_idx` ON `payment_links` (`business_id`,`customer_usuario`);
--> statement-breakpoint
-- 5. the store network's tables leave (dependents first)
--> statement-breakpoint
DROP TABLE `ledger_entries`;
--> statement-breakpoint
DROP TABLE `cash_drops`;
--> statement-breakpoint
DROP TABLE `customer_contacts`;
--> statement-breakpoint
DROP TABLE `invitations`;
--> statement-breakpoint
DROP TABLE `stores`;
