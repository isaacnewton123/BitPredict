ALTER TABLE `markets` ADD `is_demo` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `markets_demo_status_idx` ON `markets` (`is_demo`,`status`);