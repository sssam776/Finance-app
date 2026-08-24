CREATE TABLE `variance_commentary` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`period` text NOT NULL,
	`comparison` text NOT NULL,
	`account_key` text NOT NULL,
	`origin` text DEFAULT 'user' NOT NULL,
	`body` text NOT NULL,
	`cited_row_ids` text,
	`author_email` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `variance_commentary_lookup_idx` ON `variance_commentary` (`entity_id`,`period`,`account_key`);