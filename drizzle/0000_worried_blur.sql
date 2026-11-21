CREATE TABLE `inv_accounts` (
	`account_key` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`contact_name` text,
	`email` text,
	`phone` text,
	`price_list` text DEFAULT 'trade' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`notes` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "inv_accounts_status_enum" CHECK("inv_accounts"."status" in ('pending','approved','suspended','closed'))
);
--> statement-breakpoint
CREATE TABLE `inv_attributes` (
	`attribute_key` text PRIMARY KEY NOT NULL,
	`product_key` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`source_reference` text,
	`name_normalized` text NOT NULL,
	`unit_normalized` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_key`) REFERENCES `inv_products`(`product_key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inv_attributes_identity` ON `inv_attributes` (`product_key`,`name_normalized`,`unit_normalized`);--> statement-breakpoint
CREATE INDEX `inv_attributes_product_idx` ON `inv_attributes` (`product_key`);--> statement-breakpoint
CREATE TABLE `inv_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`record_key` text,
	`summary` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inv_audit_created_idx` ON `inv_audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `inv_fitments` (
	`fitment_key` text PRIMARY KEY NOT NULL,
	`product_key` text NOT NULL,
	`vehicle_key` text NOT NULL,
	`position` text,
	`required_base_units_milli` integer,
	`review_status` text DEFAULT 'draft' NOT NULL,
	`restrictions` text,
	`restriction_status` text DEFAULT 'unresolved' NOT NULL,
	`source_name` text NOT NULL,
	`source_reference` text NOT NULL,
	`notes` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_key`) REFERENCES `inv_products`(`product_key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vehicle_key`) REFERENCES `inv_vehicles`(`vehicle_key`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inv_fitments_required_base_units_milli_min" CHECK("inv_fitments"."required_base_units_milli" is null or "inv_fitments"."required_base_units_milli" >= 1),
	CONSTRAINT "inv_fitments_review_status_enum" CHECK("inv_fitments"."review_status" in ('draft','verified','rejected')),
	CONSTRAINT "inv_fitments_restriction_status_enum" CHECK("inv_fitments"."restriction_status" in ('unresolved','none','resolved'))
);
--> statement-breakpoint
CREATE INDEX `inv_fitments_product_idx` ON `inv_fitments` (`product_key`);--> statement-breakpoint
CREATE INDEX `inv_fitment_vehicle_idx` ON `inv_fitments` (`vehicle_key`);--> statement-breakpoint
CREATE TABLE `inv_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`filename` text NOT NULL,
	`status` text DEFAULT 'preview' NOT NULL,
	`mapping_json` text NOT NULL,
	`rows_json` text NOT NULL,
	`valid_count` integer NOT NULL,
	`error_count` integer NOT NULL,
	`total_count` integer NOT NULL,
	`summary_json` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	`applied_at` text
);
--> statement-breakpoint
CREATE INDEX `inv_import_created_idx` ON `inv_import_batches` (`created_at`);--> statement-breakpoint
CREATE TABLE `inv_locations` (
	`location_key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'store' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "inv_locations_type_enum" CHECK("inv_locations"."type" in ('store','warehouse','bin')),
	CONSTRAINT "inv_locations_status_enum" CHECK("inv_locations"."status" in ('active','archived'))
);
--> statement-breakpoint
CREATE TABLE `inv_offers` (
	`offer_key` text PRIMARY KEY NOT NULL,
	`supplier_key` text NOT NULL,
	`internal_sku` text NOT NULL,
	`supplier_part_number` text NOT NULL,
	`unit_cost_cents` integer,
	`purchase_pack_sell_units_milli` integer DEFAULT 1000 NOT NULL,
	`minimum_purchase_packs_milli` integer DEFAULT 1000 NOT NULL,
	`reported_available_milli` integer,
	`availability_observed_at` text,
	`lead_time_days` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`source_reference` text,
	`notes` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`supplier_key`) REFERENCES `inv_suppliers`(`supplier_key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`internal_sku`) REFERENCES `inv_skus`(`internal_sku`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inv_offers_unit_cost_cents_min" CHECK("inv_offers"."unit_cost_cents" is null or "inv_offers"."unit_cost_cents" >= 0),
	CONSTRAINT "inv_offers_purchase_pack_sell_units_milli_min" CHECK("inv_offers"."purchase_pack_sell_units_milli" is null or "inv_offers"."purchase_pack_sell_units_milli" >= 1),
	CONSTRAINT "inv_offers_minimum_purchase_packs_milli_min" CHECK("inv_offers"."minimum_purchase_packs_milli" is null or "inv_offers"."minimum_purchase_packs_milli" >= 1),
	CONSTRAINT "inv_offers_reported_available_milli_min" CHECK("inv_offers"."reported_available_milli" is null or "inv_offers"."reported_available_milli" >= 0),
	CONSTRAINT "inv_offers_lead_time_days_min" CHECK("inv_offers"."lead_time_days" is null or "inv_offers"."lead_time_days" >= 0),
	CONSTRAINT "inv_offers_status_enum" CHECK("inv_offers"."status" in ('active','archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inv_offer_supplier_part` ON `inv_offers` (`supplier_key`,`supplier_part_number`);--> statement-breakpoint
CREATE TABLE `inv_prices` (
	`price_key` text PRIMARY KEY NOT NULL,
	`price_list` text DEFAULT 'retail' NOT NULL,
	`internal_sku` text NOT NULL,
	`minimum_quantity_milli` integer DEFAULT 1000 NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`core_charge_cents` integer DEFAULT 0 NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`internal_sku`) REFERENCES `inv_skus`(`internal_sku`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inv_prices_minimum_quantity_milli_min" CHECK("inv_prices"."minimum_quantity_milli" is null or "inv_prices"."minimum_quantity_milli" >= 1),
	CONSTRAINT "inv_prices_unit_price_cents_min" CHECK("inv_prices"."unit_price_cents" is null or "inv_prices"."unit_price_cents" >= 0),
	CONSTRAINT "inv_prices_core_charge_cents_min" CHECK("inv_prices"."core_charge_cents" is null or "inv_prices"."core_charge_cents" >= 0),
	CONSTRAINT "inv_prices_status_enum" CHECK("inv_prices"."status" in ('active','archived')),
	CONSTRAINT "inv_price_dates" CHECK("inv_prices"."valid_from" is null or "inv_prices"."valid_to" is null or "inv_prices"."valid_to" >= "inv_prices"."valid_from")
);
--> statement-breakpoint
CREATE INDEX `inv_price_lookup_idx` ON `inv_prices` (`price_list`,`internal_sku`,`minimum_quantity_milli`);--> statement-breakpoint
CREATE TABLE `inv_products` (
	`product_key` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`brand` text NOT NULL,
	`manufacturer_part_number` text NOT NULL,
	`category` text NOT NULL,
	`description` text,
	`base_unit_code` text DEFAULT 'each' NOT NULL,
	`fitment_mode` text DEFAULT 'unknown' NOT NULL,
	`publication_status` text DEFAULT 'draft' NOT NULL,
	`image_url` text,
	`source_name` text,
	`source_reference` text,
	`notes` text,
	`brand_normalized` text NOT NULL,
	`mpn_normalized` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "inv_products_category_enum" CHECK("inv_products"."category" in ('brakes','batteries','filters','oil','wipers','ignition','electrical','engine','suspension','drivetrain','tools','accessories','other')),
	CONSTRAINT "inv_products_fitment_mode_enum" CHECK("inv_products"."fitment_mode" in ('unknown','vehicle_specific','specification_based','non_vehicle_specific')),
	CONSTRAINT "inv_products_publication_status_enum" CHECK("inv_products"."publication_status" in ('draft','published','archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inv_products_identity` ON `inv_products` (`brand_normalized`,`mpn_normalized`);--> statement-breakpoint
CREATE TABLE `inv_skus` (
	`internal_sku` text PRIMARY KEY NOT NULL,
	`product_key` text NOT NULL,
	`selling_unit` text DEFAULT 'each' NOT NULL,
	`base_units_per_selling_unit_milli` integer DEFAULT 1000 NOT NULL,
	`condition` text DEFAULT 'new' NOT NULL,
	`barcode` text,
	`reorder_point_milli` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_key`) REFERENCES `inv_products`(`product_key`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inv_skus_base_units_per_selling_unit_milli_min" CHECK("inv_skus"."base_units_per_selling_unit_milli" is null or "inv_skus"."base_units_per_selling_unit_milli" >= 1),
	CONSTRAINT "inv_skus_condition_enum" CHECK("inv_skus"."condition" in ('new','remanufactured','used')),
	CONSTRAINT "inv_skus_reorder_point_milli_min" CHECK("inv_skus"."reorder_point_milli" is null or "inv_skus"."reorder_point_milli" >= 0),
	CONSTRAINT "inv_skus_status_enum" CHECK("inv_skus"."status" in ('active','archived'))
);
--> statement-breakpoint
CREATE INDEX `inv_skus_product_idx` ON `inv_skus` (`product_key`);--> statement-breakpoint
CREATE TABLE `inv_stock_events` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`internal_sku` text NOT NULL,
	`location_key` text NOT NULL,
	`event_type` text DEFAULT 'adjustment' NOT NULL,
	`opening_position_key` text,
	`quantity_milli` integer NOT NULL,
	`disposition` text NOT NULL,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`internal_sku`) REFERENCES `inv_skus`(`internal_sku`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_key`) REFERENCES `inv_locations`(`location_key`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inv_stock_delta_valid" CHECK(("inv_stock_events"."event_type"='opening' and "inv_stock_events"."quantity_milli" >= 0 and "inv_stock_events"."opening_position_key" is not null) or ("inv_stock_events"."event_type"='adjustment' and "inv_stock_events"."quantity_milli" <> 0 and "inv_stock_events"."opening_position_key" is null)),
	CONSTRAINT "inv_stock_disposition_enum" CHECK("inv_stock_events"."disposition" in ('sellable','damaged','quarantine','core'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inv_stock_events_idempotency_key_unique` ON `inv_stock_events` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `inv_stock_events_opening_position_key_unique` ON `inv_stock_events` (`opening_position_key`);--> statement-breakpoint
CREATE INDEX `inv_stock_position_idx` ON `inv_stock_events` (`internal_sku`,`location_key`,`disposition`);--> statement-breakpoint
CREATE TABLE `inv_suppliers` (
	`supplier_key` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`contact_name` text,
	`email` text,
	`phone` text,
	`website` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "inv_suppliers_status_enum" CHECK("inv_suppliers"."status" in ('active','archived'))
);
--> statement-breakpoint
CREATE TABLE `inv_vehicles` (
	`vehicle_key` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`engine` text,
	`trim` text,
	`drivetrain` text,
	`transmission` text,
	`body` text,
	`market` text DEFAULT 'US' NOT NULL,
	`configuration_status` text DEFAULT 'partial' NOT NULL,
	`source_name` text,
	`source_reference` text,
	`notes` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "inv_vehicles_year_min" CHECK("inv_vehicles"."year" is null or "inv_vehicles"."year" >= 1886),
	CONSTRAINT "inv_vehicles_configuration_status_enum" CHECK("inv_vehicles"."configuration_status" in ('partial','reviewed','archived'))
);
--> statement-breakpoint
CREATE INDEX `inv_vehicle_lookup_idx` ON `inv_vehicles` (`year`,`make`,`model`);