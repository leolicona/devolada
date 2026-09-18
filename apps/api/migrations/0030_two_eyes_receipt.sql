-- two-eyes-receipt: the columns the minute-zero comparison and its
-- measurement need (specs/005-two-eyes-receipt/data-model.md).
--
-- Additive only: ten ADD COLUMN, nothing dropped, nothing renamed, no table
-- rebuild — drizzle-kit emitted plain ALTERs, which SQLite applies in place.
-- The PR preview applies this to the live dev database, so every existing
-- row keeps its meaning and reads NULL on the new columns: a payment born
-- before the cut-over has no reading_check_attempt, which is exactly what
-- the D16 legacy shape expects.
--
-- Planned as 0029; 0029 was taken by collections_api_foundation before this
-- feature landed, so it is 0030.

ALTER TABLE `extractions` ADD `legibility` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `reading_check` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `disputed_fields` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `blind_side` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `accepted_from` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `provider_tracking_key` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `provider_amount_cents` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `reading_check_attempt` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `blind_side` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `accepted_from` text;
