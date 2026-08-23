CREATE TABLE `routes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`route_geometry` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `created_at_idx` ON `routes` (`created_at`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `routes` (`user_id`);