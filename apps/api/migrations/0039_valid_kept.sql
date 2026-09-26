-- bug: valid-lost-on-later-failure (.specify/bugs/valid-lost-on-later-failure/):
-- one nullable column on `payments`, the moment Banxico's `valid` passed
-- every check of the CEP. A row that holds it resumes at the WispHub half
-- and never asks the provider again. Additive only; rows before it keep
-- NULL and run as they always did.
ALTER TABLE `payments` ADD `banxico_valid_at` integer;
