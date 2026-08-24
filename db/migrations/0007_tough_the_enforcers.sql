CREATE TABLE `reconciliation_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`period_end` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`tb_snapshot_id` text NOT NULL,
	`locked_by_email` text,
	`locked_at` text,
	`lock_acknowledged_unresolved` integer DEFAULT false NOT NULL,
	`reopened_by_email` text,
	`reopened_at` text,
	`reopen_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tb_snapshot_id`) REFERENCES `report_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reconciliation_periods_unique` ON `reconciliation_periods` (`entity_id`,`period_end`);--> statement-breakpoint
CREATE TABLE `reconciliation_workpapers` (
	`id` text PRIMARY KEY NOT NULL,
	`period_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`account_code` text NOT NULL,
	`account_name` text NOT NULL,
	`xero_account_id` text,
	`tb_row_id` text,
	`tb_amount` text NOT NULL,
	`substantiation_type` text DEFAULT 'none' NOT NULL,
	`substantiated_amount` text,
	`substantiation_source_ref` text,
	`substantiation_availability` text DEFAULT 'unavailable' NOT NULL,
	`difference` text,
	`currency` text DEFAULT 'NZD' NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`is_material` integer DEFAULT false NOT NULL,
	`timing_difference_note` text,
	`preparer_email` text,
	`prepared_at` text,
	`reviewer_email` text,
	`reviewed_at` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `reconciliation_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tb_row_id`) REFERENCES `report_rows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reconciliation_workpapers_unique` ON `reconciliation_workpapers` (`period_id`,`account_code`);--> statement-breakpoint
CREATE INDEX `reconciliation_workpapers_entity_status_idx` ON `reconciliation_workpapers` (`entity_id`,`status`);