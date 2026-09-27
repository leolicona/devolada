-- receipt-reader-tuning (specs/011-receipt-reader-tuning/data-model.md):
-- seven nullable columns on `extractions` (the question version, the
-- reader's time, the fallback, the receiving bank, its verdict, the
-- same-bank flag and its tie verdict — D11, D12, D14), and the bench's
-- two platform tables (D16). Additive only: ADD COLUMN, CREATE TABLE,
-- CREATE INDEX. Rows before it keep NULL — no guessed version. The
-- number is 0038 because 0037 went to bug: spei-date-rollover.
CREATE TABLE `bench_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`bench_receipt_id` text NOT NULL,
	`model` text NOT NULL,
	`model_label` text NOT NULL,
	`question_version` text NOT NULL,
	`status` text NOT NULL,
	`failure_code` text,
	`reader_ms` integer NOT NULL,
	`reading` text,
	`raw_output` text,
	`marks` text,
	`marked_by` text,
	`marked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bench_receipt_id`) REFERENCES `bench_receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`marked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bench_readings_receipt_model_version_idx` ON `bench_readings` (`bench_receipt_id`,`model`,`question_version`);--> statement-breakpoint
CREATE INDEX `bench_readings_created_idx` ON `bench_readings` (`created_at`);--> statement-breakpoint
CREATE TABLE `bench_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`proof_key` text NOT NULL,
	`sha256` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bench_receipts_sha256_unique` ON `bench_receipts` (`sha256`);--> statement-breakpoint
ALTER TABLE `extractions` ADD `question_version` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `reader_ms` integer;--> statement-breakpoint
ALTER TABLE `extractions` ADD `fallback_from` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `receiving_bank` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `gate_receiving_bank` text;--> statement-breakpoint
ALTER TABLE `extractions` ADD `same_bank` integer;--> statement-breakpoint
ALTER TABLE `extractions` ADD `receiving_bank_tie` text;