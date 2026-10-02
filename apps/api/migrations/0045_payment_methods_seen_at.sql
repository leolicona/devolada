-- payment-method-per-channel D16 (specs/019-payment-method-per-channel/data-model.md):
-- `integrations.payment_methods_seen_at`, the last moment Devolada saw the
-- business's payment methods for its stored key and installation. The
-- WispHub method-list cache key carries it as its version, so a new stamp
-- makes the next payment read the list again in every data center (FR-014).
-- Additive only: ADD COLUMN, nullable, no backfill (D11).
ALTER TABLE `integrations` ADD `payment_methods_seen_at` integer;