CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`entity_id` text,
	`resource_type` text,
	`resource_id` text,
	`detail` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bank_balance_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`bank_import_id` text NOT NULL,
	`entity_bank_account_id` text NOT NULL,
	`balance_date` text NOT NULL,
	`source_timezone` text DEFAULT 'Pacific/Auckland' NOT NULL,
	`closing_balance` text NOT NULL,
	`currency` text DEFAULT 'NZD' NOT NULL,
	`source_row_ref` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`bank_import_id`) REFERENCES `bank_imports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entity_bank_account_id`) REFERENCES `entity_bank_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bank_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`bank_name` text NOT NULL,
	`source_file_key` text NOT NULL,
	`source_file_checksum` text NOT NULL,
	`file_received_at` text NOT NULL,
	`processed_at` text,
	`imported_by_email` text NOT NULL,
	`parser_version` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`short_code` text NOT NULL,
	`display_name` text NOT NULL,
	`entity_type` text NOT NULL,
	`status` text DEFAULT 'unverified' NOT NULL,
	`xero_tenant_id` text,
	`xero_organisation_name` text,
	`financial_year_end` text,
	`reporting_currency` text DEFAULT 'NZD' NOT NULL,
	`gst_registered` integer,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entities_short_code_unique` ON `entities` (`short_code`);--> statement-breakpoint
CREATE TABLE `entity_bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`bank_name` text NOT NULL,
	`account_number` text NOT NULL,
	`account_name` text NOT NULL,
	`currency` text DEFAULT 'NZD' NOT NULL,
	`xero_account_code` text,
	`is_loan_facility` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_bank_accounts_unique` ON `entity_bank_accounts` (`entity_id`,`account_number`);--> statement-breakpoint
CREATE TABLE `entity_xero_app_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`purpose` text NOT NULL,
	`xero_app_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`xero_app_id`) REFERENCES `xero_apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`) REFERENCES `xero_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entity_xero_app_assignments_active_idx` ON `entity_xero_app_assignments` (`entity_id`,`purpose`,`status`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`xero_app_id` text,
	`connection_id` text,
	`entity_id` text,
	`resource` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`records_read` integer DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`xero_app_id`) REFERENCES `xero_apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`) REFERENCES `xero_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `xero_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`xero_app_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`xero_account_id` text NOT NULL,
	`code` text,
	`name` text NOT NULL,
	`type` text,
	`current_balance` text,
	`balance_as_at` text,
	`source_updated_at` text,
	`sync_run_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `xero_accounts_entity_account_unique` ON `xero_accounts` (`entity_id`,`xero_account_id`);--> statement-breakpoint
CREATE TABLE `xero_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`app_key` text NOT NULL,
	`display_name` text NOT NULL,
	`environment` text NOT NULL,
	`purpose` text NOT NULL,
	`tier` text NOT NULL,
	`connection_limit` integer NOT NULL,
	`scope_profile` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`client_id_secret_ref` text NOT NULL,
	`client_secret_secret_ref` text NOT NULL,
	`operational_owner` text,
	`compliance_status` text DEFAULT 'draft' NOT NULL,
	`approval_reference` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `xero_apps_app_key_unique` ON `xero_apps` (`app_key`);--> statement-breakpoint
CREATE TABLE `xero_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`xero_app_id` text NOT NULL,
	`encrypted_token_set` text NOT NULL,
	`encryption_key_version` integer NOT NULL,
	`token_expires_at` text NOT NULL,
	`granted_scopes` text NOT NULL,
	`refresh_version` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_refresh_at` text,
	`last_refresh_error` text,
	`authorising_user_email` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`xero_app_id`) REFERENCES `xero_apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `xero_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`xero_app_id` text NOT NULL,
	`authorization_id` text NOT NULL,
	`xero_tenant_id` text NOT NULL,
	`xero_tenant_type` text,
	`xero_organisation_name` text,
	`status` text DEFAULT 'pending_authorisation' NOT NULL,
	`first_connected_at` text,
	`last_connected_at` text,
	`last_successful_call_at` text,
	`disconnected_at` text,
	`disconnected_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`xero_app_id`) REFERENCES `xero_apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`authorization_id`) REFERENCES `xero_authorizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `xero_connections_app_tenant_unique` ON `xero_connections` (`xero_app_id`,`xero_tenant_id`);--> statement-breakpoint
CREATE TABLE `xero_oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`xero_app_id` text NOT NULL,
	`state` text NOT NULL,
	`initiating_user_email` text NOT NULL,
	`intended_entity_id` text,
	`intended_purpose` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`xero_app_id`) REFERENCES `xero_apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `xero_oauth_states_state_unique` ON `xero_oauth_states` (`state`);