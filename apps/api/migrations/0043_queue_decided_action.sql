-- bug: queue-retry-forgets-action — `payments.decided_action`, the action the
-- verdict decided for the row, so a retry runs that action and never the
-- adapter's default reconnect. Spec 017's migration (0042) landed on `main`
-- first, so this takes the next number. Additive only: ADD COLUMN.
ALTER TABLE `payments` ADD `decided_action` text;