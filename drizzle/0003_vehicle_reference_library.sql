CREATE TABLE `inv_vehicle_reference` (
 `reference_key` text PRIMARY KEY NOT NULL,
 `year` integer NOT NULL,
 `make` text NOT NULL,
 `model` text NOT NULL,
 `display_model` text NOT NULL,
 `configuration_hint` text,
 `source_name` text NOT NULL,
 `source_url` text,
 `review_status` text NOT NULL DEFAULT 'unreviewed',
 `imported_at` text NOT NULL,
 `updated_at` text NOT NULL,
 CONSTRAINT `inv_vehicle_reference_year_check` CHECK (`year` BETWEEN 1886 AND 2100),
 CONSTRAINT `inv_vehicle_reference_status_check` CHECK (`review_status` IN ('unreviewed','needs_review','reviewed'))
);
--> statement-breakpoint
CREATE INDEX `inv_vehicle_reference_lookup` ON `inv_vehicle_reference` (`year`,`make`,`display_model`);
--> statement-breakpoint
CREATE INDEX `inv_vehicle_reference_raw_lookup` ON `inv_vehicle_reference` (`year`,`make`,`model`);
