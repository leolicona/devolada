ALTER TABLE `isps` ADD `timezone` text DEFAULT 'America/Mexico_City' NOT NULL;--> statement-breakpoint
ALTER TABLE `isps` ADD `time_format` text DEFAULT '12h' NOT NULL;