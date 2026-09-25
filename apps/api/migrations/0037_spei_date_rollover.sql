-- bug: spei-date-rollover — the time a receipt prints beside its date, so a
-- search by referencia numérica can ask Banxico the operation day (SPEI
-- changes it at 18:00 Mexico City time) instead of the calendar day.
--
-- Additive only: one nullable ADD COLUMN, which SQLite applies in place. A
-- reading recorded before this reads NULL, and a NULL time falls back to
-- when the payment was submitted.

ALTER TABLE `extractions` ADD `transfer_time` text;
