-- receipt-triage: the columns the second key, the cuenta de cobro, the
-- held-for-review payment and the feature's measurement need
-- (specs/010-receipt-triage/data-model.md).
--
-- Additive only: seventeen ADD COLUMN and one non-unique index, nothing
-- dropped, nothing renamed, no table rebuild — drizzle-kit emitted plain
-- ALTERs, which SQLite applies in place. The PR preview applies this to the
-- live dev database, so every existing row keeps its meaning and reads NULL
-- on the new columns: a business with NULL spei_collect_kind collects at its
-- CLABE (D29), and a payment with NULL beneficiary and registered_accounts
-- finishes under the flow it started in (D27, FR-027).

ALTER TABLE `businesses` ADD `spei_card` text;--> statement-breakpoint
ALTER TABLE `businesses` ADD `spei_card_bank` text;--> statement-breakpoint
ALTER TABLE `businesses` ADD `spei_phone` text;--> statement-breakpoint
ALTER TABLE `businesses` ADD `spei_phone_bank` text;--> statement-breakpoint
ALTER TABLE `businesses` ADD `spei_collect_kind` text;--> statement-breakpoint
ALTER TABLE `businesses` ADD `spei_retired_accounts` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `proof_key` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `reference_number` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `provider_reference_number` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `destination_kind` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `destination_digits` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `reference_number` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `beneficiary` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `registered_accounts` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `review_reason` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `reviewed_by` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `reviewed_at` integer;--> statement-breakpoint
CREATE INDEX `payments_business_reference_idx` ON `payments` (`business_id`,`reference_number`,`transfer_date`);