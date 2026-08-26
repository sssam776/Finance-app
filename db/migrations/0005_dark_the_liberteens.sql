CREATE TABLE `report_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`row_order` integer NOT NULL,
	`section_title` text,
	`section_kind` text,
	`account_code` text,
	`account_name` text NOT NULL,
	`xero_account_id` text,
	`period_key` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text DEFAULT 'NZD' NOT NULL,
	`source_debit` text,
	`source_credit` text,
	`is_subtotal` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `report_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `report_rows_snapshot_idx` ON `report_rows` (`snapshot_id`,`row_order`);--> statement-breakpoint
CREATE INDEX `report_rows_account_idx` ON `report_rows` (`snapshot_id`,`account_code`);--> statement-breakpoint
CREATE TABLE `report_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`report_type` text NOT NULL,
	`period_end` text NOT NULL,
	`xero_app_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`sync_run_id` text NOT NULL,
	`source_report_id` text,
	`report_title` text,
	`payload_hash` text NOT NULL,
	`raw_file_key` text,
	`parser_version` text NOT NULL,
	`debit_total` text,
	`credit_total` text,
	`balanced` integer,
	`row_count` integer DEFAULT 0 NOT NULL,
	`fetched_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_snapshots_run_unique` ON `report_snapshots` (`entity_id`,`report_type`,`period_end`,`sync_run_id`);--> statement-breakpoint
CREATE INDEX `report_snapshots_lookup_idx` ON `report_snapshots` (`entity_id`,`report_type`,`period_end`);