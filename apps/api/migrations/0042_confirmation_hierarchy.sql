-- confirmation-hierarchy (specs/017-confirmation-hierarchy/data-model.md):
-- `payments.tie_break`, the outcome of the tie-break answer a row carried
-- (D7) — NULL on every row that carried none — and the index the
-- exclusivity query seeks by, `cep_records (business_id, sender_account)`
-- (D4). Spec 012's migration (0041) landed on `main` first, so these take
-- the next number (data-model.md). Additive only: ADD COLUMN, CREATE INDEX.
ALTER TABLE `payments` ADD `tie_break` text;--> statement-breakpoint
CREATE INDEX `cep_records_business_account_idx` ON `cep_records` (`business_id`,`sender_account`);