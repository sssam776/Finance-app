CREATE TABLE `covenant_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`lender_id` text NOT NULL,
	`pool_id` text,
	`metric` text NOT NULL,
	`operator` text NOT NULL,
	`threshold` text NOT NULL,
	`valuation_basis` text,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`rule_type` text DEFAULT 'covenant' NOT NULL,
	`source_lineage_id` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`lender_id`) REFERENCES `lenders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pool_id`) REFERENCES `lender_pools`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_lineage_id`) REFERENCES `source_lineage`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `covenant_rules_lookup_idx` ON `covenant_rules` (`lender_id`,`metric`,`effective_from`);--> statement-breakpoint
CREATE TABLE `facility_events` (
	`id` text PRIMARY KEY NOT NULL,
	`facility_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_date` text NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	`source` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `loan_facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `facility_events_facility_date_idx` ON `facility_events` (`facility_id`,`event_date`);--> statement-breakpoint
CREATE INDEX `facility_events_date_idx` ON `facility_events` (`event_date`);--> statement-breakpoint
CREATE TABLE `lender_pools` (
	`id` text PRIMARY KEY NOT NULL,
	`lender_id` text NOT NULL,
	`name` text NOT NULL,
	`target_lvr` text NOT NULL,
	`stress_rate` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`lender_id`) REFERENCES `lenders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lender_pools_lender_name_unique` ON `lender_pools` (`lender_id`,`name`);--> statement-breakpoint
CREATE TABLE `lenders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`lender_type` text DEFAULT 'senior' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lenders_name_unique` ON `lenders` (`name`);--> statement-breakpoint
CREATE TABLE `loan_facilities` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`lender_id` text NOT NULL,
	`pool_id` text,
	`facility_reference` text NOT NULL,
	`facility_type` text DEFAULT 'term_loan' NOT NULL,
	`facility_limit` text,
	`drawn_amount` text DEFAULT '0' NOT NULL,
	`currency` text DEFAULT 'NZD' NOT NULL,
	`interest_rate` text,
	`rate_type` text DEFAULT 'unknown' NOT NULL,
	`interest_capitalised` integer DEFAULT false NOT NULL,
	`include_in_available_liquidity` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lender_id`) REFERENCES `lenders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pool_id`) REFERENCES `lender_pools`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loan_facilities_lender_reference_unique` ON `loan_facilities` (`lender_id`,`facility_reference`);--> statement-breakpoint
CREATE INDEX `loan_facilities_pool_idx` ON `loan_facilities` (`pool_id`);--> statement-breakpoint
CREATE INDEX `loan_facilities_entity_idx` ON `loan_facilities` (`entity_id`);--> statement-breakpoint
CREATE TABLE `properties` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`asset_type` text,
	`status` text DEFAULT 'investment' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `properties_entity_name_unique` ON `properties` (`entity_id`,`name`);--> statement-breakpoint
CREATE INDEX `properties_status_idx` ON `properties` (`status`);--> statement-breakpoint
CREATE TABLE `property_noi_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`annual_noi` text NOT NULL,
	`currency` text DEFAULT 'NZD' NOT NULL,
	`as_of_date` text NOT NULL,
	`mapping_status` text DEFAULT 'mapped' NOT NULL,
	`source_lineage_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_lineage_id`) REFERENCES `source_lineage`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `property_noi_snapshots_lookup_idx` ON `property_noi_snapshots` (`property_id`,`as_of_date`);--> statement-breakpoint
CREATE TABLE `property_pool_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`pool_id` text NOT NULL,
	`contribution_share` text DEFAULT '1' NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pool_id`) REFERENCES `lender_pools`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `property_pool_memberships_property_idx` ON `property_pool_memberships` (`property_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `property_pool_memberships_pool_idx` ON `property_pool_memberships` (`pool_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `property_valuations` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`basis` text NOT NULL,
	`value` text NOT NULL,
	`currency` text DEFAULT 'NZD' NOT NULL,
	`valuation_date` text,
	`valuer` text,
	`source_lineage_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_lineage_id`) REFERENCES `source_lineage`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `property_valuations_lookup_idx` ON `property_valuations` (`property_id`,`basis`,`valuation_date`);--> statement-breakpoint
CREATE TABLE `source_lineage` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_name` text NOT NULL,
	`sheet_name` text,
	`cell_or_row_ref` text,
	`source_as_of_date` text,
	`bank_import_id` text,
	`recorded_by_email` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`bank_import_id`) REFERENCES `bank_imports`(`id`) ON UPDATE no action ON DELETE no action
);
