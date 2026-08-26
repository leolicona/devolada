ALTER TABLE `charges` RENAME COLUMN "monthly_fee_cents" TO "invoice_cents";--> statement-breakpoint
ALTER TABLE `direct_payments` RENAME COLUMN "monthly_fee_cents" TO "invoice_cents";--> statement-breakpoint
ALTER TABLE `charges` ADD `carried_balance_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `direct_payments` ADD `carried_balance_cents` integer DEFAULT 0 NOT NULL;