CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`route_geometry` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_routes`("id", "user_id", "origin", "destination", "route_geometry", "created_at") SELECT "id", "user_id", "origin", "destination", "route_geometry", "created_at" FROM `routes`;--> statement-breakpoint
DROP TABLE `routes`;--> statement-breakpoint
ALTER TABLE `__new_routes` RENAME TO `routes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `created_at_idx` ON `routes` (`created_at`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `routes` (`user_id`);