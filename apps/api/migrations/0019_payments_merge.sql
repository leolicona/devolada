-- Payments merge (docs/business/business-and-memberships.spec.md D6): one row
--> statement-breakpoint
-- is the whole payment. `direct_payments` becomes `payments` and absorbs its
--> statement-breakpoint
-- `charges` twin (folio, customer, registered amount, reconnection queue;
--> statement-breakpoint
-- the twin's last_error becomes reconnection_error). Rebuilds follow the
--> statement-breakpoint
-- 0007 pattern under one deferred-FK transaction (TESTING.md rule 12).
--> statement-breakpoint
PRAGMA defer_foreign_keys = true;
--> statement-breakpoint
ALTER TABLE `direct_payments` RENAME TO `payments`;
--> statement-breakpoint
CREATE TABLE `__copy_payments` (
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
	`validation_attempts` integer,
	`next_validation_at` integer,
	`last_error` text,
	`confirmed_at` integer,
	`provisional_release_at` integer,
	`release_evidence` text,
	`release_kind` text,
	`trust_snapshot` text,
	`folio` text,
	`channel` text,
	`wisphub_customer_id` text,
	`customer_usuario` text,
	`customer_name` text,
	`customer_zone` text,
	`customer_phone` text,
	`registered_cents` integer,
	`reconnection_status` text,
	`reconnection_attempts` integer,
	`reconnected_at` integer,
	`wisphub_invoice_id` integer,
	`next_attempt_at` integer,
	`payment_registered_at` integer,
	`reconnection_error` text,
	`reconciliation_class` text,
	`created_at` integer
);
--> statement-breakpoint
INSERT INTO `__copy_payments` ("id", "payment_link_id", "business_id", "amount_cents", "invoice_cents", "carried_balance_cents", "received_cents", "claimed_amount_cents", "reading_check", "disputed_fields", "service_fee_cents", "status", "proof_mode", "tracking_key", "sender_bank", "transfer_date", "proof_key", "receipt_status", "cep_sender_name", "supersedes_id", "consta_validation_id", "consta_status", "validation_attempts", "next_validation_at", "last_error", "confirmed_at", "provisional_release_at", "release_evidence", "release_kind", "trust_snapshot", "created_at", "folio", "channel", "wisphub_customer_id", "customer_usuario", "customer_name", "customer_zone", "customer_phone", "registered_cents", "reconnection_status", "reconnection_attempts", "reconnected_at", "wisphub_invoice_id", "next_attempt_at", "payment_registered_at", "reconnection_error", "reconciliation_class") SELECT p."id", p."payment_link_id", p."business_id", p."amount_cents", p."invoice_cents", p."carried_balance_cents", p."received_cents", p."claimed_amount_cents", p."reading_check", p."disputed_fields", p."service_fee_cents", p."status", p."proof_mode", p."tracking_key", p."sender_bank", p."transfer_date", p."proof_key", p."receipt_status", p."cep_sender_name", p."supersedes_id", p."consta_validation_id", p."consta_status", p."validation_attempts", p."next_validation_at", p."last_error", p."confirmed_at", p."provisional_release_at", p."release_evidence", p."release_kind", p."trust_snapshot", p."created_at", c."folio", 'spei', c."wisphub_customer_id", c."customer_usuario", c."customer_name", c."customer_zone", c."customer_phone", c."invoice_cents" + c."carried_balance_cents", c."reconnection_status", COALESCE(c."reconnection_attempts", 0), c."reconnected_at", c."wisphub_invoice_id", c."next_attempt_at", c."payment_registered_at", c."last_error", NULL FROM `payments` p LEFT JOIN `charges` c ON c.`id` = p.`charge_id`;
--> statement-breakpoint
DROP TABLE `charges`;
--> statement-breakpoint
DROP TABLE `payments`;
--> statement-breakpoint
CREATE TABLE `payments` (
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
	`validation_attempts` integer DEFAULT 0 NOT NULL,
	`next_validation_at` integer,
	`last_error` text,
	`confirmed_at` integer,
	`provisional_release_at` integer,
	`release_evidence` text,
	`release_kind` text,
	`trust_snapshot` text,
	`folio` text,
	`channel` text DEFAULT 'spei' NOT NULL,
	`wisphub_customer_id` text,
	`customer_usuario` text,
	`customer_name` text,
	`customer_zone` text,
	`customer_phone` text,
	`registered_cents` integer,
	`reconnection_status` text,
	`reconnection_attempts` integer DEFAULT 0 NOT NULL,
	`reconnected_at` integer,
	`wisphub_invoice_id` integer,
	`next_attempt_at` integer,
	`payment_registered_at` integer,
	`reconnection_error` text,
	`reconciliation_class` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payment_link_id`) REFERENCES `payment_links`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `payments`("id", "payment_link_id", "business_id", "amount_cents", "invoice_cents", "carried_balance_cents", "received_cents", "claimed_amount_cents", "reading_check", "disputed_fields", "service_fee_cents", "status", "proof_mode", "tracking_key", "sender_bank", "transfer_date", "proof_key", "receipt_status", "cep_sender_name", "supersedes_id", "consta_validation_id", "consta_status", "validation_attempts", "next_validation_at", "last_error", "confirmed_at", "provisional_release_at", "release_evidence", "release_kind", "trust_snapshot", "created_at", "folio", "channel", "wisphub_customer_id", "customer_usuario", "customer_name", "customer_zone", "customer_phone", "registered_cents", "reconnection_status", "reconnection_attempts", "reconnected_at", "wisphub_invoice_id", "next_attempt_at", "payment_registered_at", "reconnection_error", "reconciliation_class") SELECT "id", "payment_link_id", "business_id", "amount_cents", "invoice_cents", "carried_balance_cents", "received_cents", "claimed_amount_cents", "reading_check", "disputed_fields", "service_fee_cents", "status", "proof_mode", "tracking_key", "sender_bank", "transfer_date", "proof_key", "receipt_status", "cep_sender_name", "supersedes_id", "consta_validation_id", "consta_status", "validation_attempts", "next_validation_at", "last_error", "confirmed_at", "provisional_release_at", "release_evidence", "release_kind", "trust_snapshot", "created_at", "folio", "channel", "wisphub_customer_id", "customer_usuario", "customer_name", "customer_zone", "customer_phone", "registered_cents", "reconnection_status", "reconnection_attempts", "reconnected_at", "wisphub_invoice_id", "next_attempt_at", "payment_registered_at", "reconnection_error", "reconciliation_class" FROM `__copy_payments`;
--> statement-breakpoint
DROP TABLE `__copy_payments`;
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_folio_unique` ON `payments` (`folio`);
--> statement-breakpoint
CREATE INDEX `payments_link_idx` ON `payments` (`payment_link_id`);
--> statement-breakpoint
CREATE INDEX `payments_due_idx` ON `payments` (`status`,`next_validation_at`);
--> statement-breakpoint
CREATE INDEX `payments_reconnection_due_idx` ON `payments` (`reconnection_status`,`next_attempt_at`);
--> statement-breakpoint
CREATE INDEX `payments_business_created_idx` ON `payments` (`business_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_business_tracking_idx` ON `payments` (`business_id`,`tracking_key`) WHERE tracking_key IS NOT NULL AND status NOT IN ('invalid', 'expired', 'superseded');
--> statement-breakpoint
-- proof_rejections: its FK now names `payments`; rebuilt the same way
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
	FOREIGN KEY (`owner_payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `proof_rejections`("id", "business_id", "payment_link_id", "owner_payment_id", "tracking_key", "created_at") SELECT "id", "business_id", "payment_link_id", "owner_payment_id", "tracking_key", "created_at" FROM `__copy_proof_rejections`;
--> statement-breakpoint
DROP TABLE `__copy_proof_rejections`;
--> statement-breakpoint
CREATE INDEX `proof_rejections_link_idx` ON `proof_rejections` (`payment_link_id`,`created_at`);
