DROP INDEX `variance_thresholds_scope_unique`;--> statement-breakpoint
ALTER TABLE `variance_thresholds` ADD `context` text DEFAULT 'cash' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `variance_thresholds_scope_context_unique` ON `variance_thresholds` (`entity_id`,`context`);