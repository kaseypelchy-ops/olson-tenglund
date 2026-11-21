import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = () => ({ revision: integer("revision").notNull().default(1), created_at: text("created_at").notNull(), updated_at: text("updated_at").notNull() });

export const products = sqliteTable("inv_products", {
  product_key: text("product_key").notNull().primaryKey(),
  title: text("title").notNull(),
  brand: text("brand").notNull(),
  manufacturer_part_number: text("manufacturer_part_number").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  base_unit_code: text("base_unit_code").notNull().default("each"),
  fitment_mode: text("fitment_mode").notNull().default("unknown"),
  publication_status: text("publication_status").notNull().default("draft"),
  image_url: text("image_url"),
  source_name: text("source_name"),
  source_reference: text("source_reference"),
  notes: text("notes"),
  brand_normalized: text("brand_normalized").notNull(), mpn_normalized: text("mpn_normalized").notNull(),
  ...timestamps(),
}, t => [check("inv_products_category_enum", sql`${t.category} in ('brakes','batteries','filters','oil','wipers','ignition','electrical','engine','suspension','drivetrain','tools','accessories','other')`),
  check("inv_products_fitment_mode_enum", sql`${t.fitment_mode} in ('unknown','vehicle_specific','specification_based','non_vehicle_specific')`),
  check("inv_products_publication_status_enum", sql`${t.publication_status} in ('draft','published','archived')`),
  uniqueIndex("inv_products_identity").on(t.brand_normalized, t.mpn_normalized)]);

export const attributes = sqliteTable("inv_attributes", {
  attribute_key: text("attribute_key").notNull().primaryKey(),
  product_key: text("product_key").notNull().references(() => products.product_key),
  name: text("name").notNull(),
  value: text("value").notNull(),
  unit: text("unit").notNull().default(""),
  source_reference: text("source_reference"),
  name_normalized: text("name_normalized").notNull(), unit_normalized: text("unit_normalized").notNull(),
  ...timestamps(),
}, t => [uniqueIndex("inv_attributes_identity").on(t.product_key, t.name_normalized, t.unit_normalized),
  index("inv_attributes_product_idx").on(t.product_key)]);

export const skus = sqliteTable("inv_skus", {
  internal_sku: text("internal_sku").notNull().primaryKey(),
  product_key: text("product_key").notNull().references(() => products.product_key),
  selling_unit: text("selling_unit").notNull().default("each"),
  base_units_per_selling_unit_milli: integer("base_units_per_selling_unit_milli").notNull().default(1000),
  condition: text("condition").notNull().default("new"),
  barcode: text("barcode"),
  reorder_point_milli: integer("reorder_point_milli").notNull().default(0),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  ...timestamps(),
}, t => [check("inv_skus_base_units_per_selling_unit_milli_min", sql`${t.base_units_per_selling_unit_milli} is null or ${t.base_units_per_selling_unit_milli} >= 1`),
  check("inv_skus_condition_enum", sql`${t.condition} in ('new','remanufactured','used')`),
  check("inv_skus_reorder_point_milli_min", sql`${t.reorder_point_milli} is null or ${t.reorder_point_milli} >= 0`),
  check("inv_skus_status_enum", sql`${t.status} in ('active','archived')`),
  index("inv_skus_product_idx").on(t.product_key)]);

export const vehicles = sqliteTable("inv_vehicles", {
  vehicle_key: text("vehicle_key").notNull().primaryKey(),
  year: integer("year").notNull(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  engine: text("engine"),
  trim: text("trim"),
  drivetrain: text("drivetrain"),
  transmission: text("transmission"),
  body: text("body"),
  market: text("market").notNull().default("US"),
  configuration_status: text("configuration_status").notNull().default("partial"),
  source_name: text("source_name"),
  source_reference: text("source_reference"),
  notes: text("notes"),
  ...timestamps(),
}, t => [check("inv_vehicles_year_min", sql`${t.year} is null or ${t.year} >= 1886`),
  check("inv_vehicles_configuration_status_enum", sql`${t.configuration_status} in ('partial','reviewed','archived')`),
  index("inv_vehicle_lookup_idx").on(t.year,t.make,t.model)]);

export const fitments = sqliteTable("inv_fitments", {
  fitment_key: text("fitment_key").notNull().primaryKey(),
  product_key: text("product_key").notNull().references(() => products.product_key),
  vehicle_key: text("vehicle_key").notNull().references(() => vehicles.vehicle_key),
  position: text("position"),
  required_base_units_milli: integer("required_base_units_milli"),
  review_status: text("review_status").notNull().default("draft"),
  restrictions: text("restrictions"),
  restriction_status: text("restriction_status").notNull().default("unresolved"),
  source_name: text("source_name").notNull(),
  source_reference: text("source_reference").notNull(),
  notes: text("notes"),
  ...timestamps(),
}, t => [check("inv_fitments_required_base_units_milli_min", sql`${t.required_base_units_milli} is null or ${t.required_base_units_milli} >= 1`),
  check("inv_fitments_review_status_enum", sql`${t.review_status} in ('draft','verified','rejected')`),
  check("inv_fitments_restriction_status_enum", sql`${t.restriction_status} in ('unresolved','none','resolved')`),
  index("inv_fitments_product_idx").on(t.product_key),
  index("inv_fitment_vehicle_idx").on(t.vehicle_key)]);

export const suppliers = sqliteTable("inv_suppliers", {
  supplier_key: text("supplier_key").notNull().primaryKey(),
  company: text("company").notNull(),
  contact_name: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  ...timestamps(),
}, t => [check("inv_suppliers_status_enum", sql`${t.status} in ('active','archived')`)]);

export const offers = sqliteTable("inv_offers", {
  offer_key: text("offer_key").notNull().primaryKey(),
  supplier_key: text("supplier_key").notNull().references(() => suppliers.supplier_key),
  internal_sku: text("internal_sku").notNull().references(() => skus.internal_sku),
  supplier_part_number: text("supplier_part_number").notNull(),
  unit_cost_cents: integer("unit_cost_cents"),
  purchase_pack_sell_units_milli: integer("purchase_pack_sell_units_milli").notNull().default(1000),
  minimum_purchase_packs_milli: integer("minimum_purchase_packs_milli").notNull().default(1000),
  reported_available_milli: integer("reported_available_milli"),
  availability_observed_at: text("availability_observed_at"),
  lead_time_days: integer("lead_time_days"),
  status: text("status").notNull().default("active"),
  source_reference: text("source_reference"),
  notes: text("notes"),
  ...timestamps(),
}, t => [check("inv_offers_unit_cost_cents_min", sql`${t.unit_cost_cents} is null or ${t.unit_cost_cents} >= 0`),
  check("inv_offers_purchase_pack_sell_units_milli_min", sql`${t.purchase_pack_sell_units_milli} is null or ${t.purchase_pack_sell_units_milli} >= 1`),
  check("inv_offers_minimum_purchase_packs_milli_min", sql`${t.minimum_purchase_packs_milli} is null or ${t.minimum_purchase_packs_milli} >= 1`),
  check("inv_offers_reported_available_milli_min", sql`${t.reported_available_milli} is null or ${t.reported_available_milli} >= 0`),
  check("inv_offers_lead_time_days_min", sql`${t.lead_time_days} is null or ${t.lead_time_days} >= 0`),
  check("inv_offers_status_enum", sql`${t.status} in ('active','archived')`),
  uniqueIndex("inv_offer_supplier_part").on(t.supplier_key,t.supplier_part_number)]);

export const locations = sqliteTable("inv_locations", {
  location_key: text("location_key").notNull().primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("store"),
  status: text("status").notNull().default("active"),
  address_line1: text("address_line1"),
  address_line2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postal_code: text("postal_code"),
  phone: text("phone"),
  store_hours: text("store_hours"),
  notes: text("notes"),
  ...timestamps(),
}, t => [check("inv_locations_type_enum", sql`${t.type} in ('store','warehouse','bin')`),
  check("inv_locations_status_enum", sql`${t.status} in ('active','archived')`)]);

export const prices = sqliteTable("inv_prices", {
  price_key: text("price_key").notNull().primaryKey(),
  price_list: text("price_list").notNull().default("retail"),
  internal_sku: text("internal_sku").notNull().references(() => skus.internal_sku),
  minimum_quantity_milli: integer("minimum_quantity_milli").notNull().default(1000),
  unit_price_cents: integer("unit_price_cents").notNull(),
  core_charge_cents: integer("core_charge_cents").notNull().default(0),
  valid_from: text("valid_from"),
  valid_to: text("valid_to"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  ...timestamps(),
}, t => [check("inv_prices_minimum_quantity_milli_min", sql`${t.minimum_quantity_milli} is null or ${t.minimum_quantity_milli} >= 1`),
  check("inv_prices_unit_price_cents_min", sql`${t.unit_price_cents} is null or ${t.unit_price_cents} >= 0`),
  check("inv_prices_core_charge_cents_min", sql`${t.core_charge_cents} is null or ${t.core_charge_cents} >= 0`),
  check("inv_prices_status_enum", sql`${t.status} in ('active','archived')`),
  check("inv_price_dates", sql`${t.valid_from} is null or ${t.valid_to} is null or ${t.valid_to} >= ${t.valid_from}`),
  index("inv_price_lookup_idx").on(t.price_list,t.internal_sku,t.minimum_quantity_milli)]);

export const accounts = sqliteTable("inv_accounts", {
  account_key: text("account_key").notNull().primaryKey(),
  company: text("company").notNull(),
  contact_name: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  price_list: text("price_list").notNull().default("trade"),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  ...timestamps(),
}, t => [check("inv_accounts_status_enum", sql`${t.status} in ('pending','approved','suspended','closed')`)]);

// Quantities are integer thousandths of the SKU SELLING UNIT. Immutable ledger;
// a stock adjustment is a single conditional INSERT, not a read-then-write.
export const stockEvents = sqliteTable("inv_stock_events", {
  id: text("id").primaryKey().notNull(), idempotency_key: text("idempotency_key").notNull().unique(),
  internal_sku: text("internal_sku").notNull().references(() => skus.internal_sku),
  location_key: text("location_key").notNull().references(() => locations.location_key),
  event_type: text("event_type").notNull().default("adjustment"), opening_position_key: text("opening_position_key").unique(),
  quantity_milli: integer("quantity_milli").notNull(), disposition: text("disposition").notNull(),
  reason: text("reason").notNull(), actor: text("actor").notNull(), created_at: text("created_at").notNull(),
}, t => [index("inv_stock_position_idx").on(t.internal_sku,t.location_key,t.disposition),
  check("inv_stock_delta_valid", sql`(${t.event_type}='opening' and ${t.quantity_milli} >= 0 and ${t.opening_position_key} is not null) or (${t.event_type}='adjustment' and ${t.quantity_milli} <> 0 and ${t.opening_position_key} is null)`),
  check("inv_stock_disposition_enum", sql`${t.disposition} in ('sellable','damaged','quarantine','core')`)]);
export const importBatches = sqliteTable("inv_import_batches", {
  id: text("id").primaryKey().notNull(), entity: text("entity").notNull(), filename: text("filename").notNull(),
  status: text("status").notNull().default("preview"), mapping_json: text("mapping_json").notNull(), rows_json: text("rows_json").notNull(),
  valid_count: integer("valid_count").notNull(), error_count: integer("error_count").notNull(), total_count: integer("total_count").notNull(),
  summary_json: text("summary_json").notNull(), actor: text("actor").notNull(), created_at: text("created_at").notNull(), applied_at: text("applied_at"),
}, t => [index("inv_import_created_idx").on(t.created_at)]);
export const auditLog = sqliteTable("inv_audit_log", {
  id: text("id").primaryKey().notNull(), action: text("action").notNull(), entity: text("entity").notNull(), record_key: text("record_key"),
  summary: text("summary").notNull(), actor: text("actor").notNull(), created_at: text("created_at").notNull(),
}, t => [index("inv_audit_created_idx").on(t.created_at)]);

// Broad year/make/model references: deliberately distinct from verified vehicle
// configurations and fitment applications. No foreign key to inv_fitments.
export const vehicleReferences = sqliteTable("inv_vehicle_reference", {
 reference_key: text("reference_key").notNull().primaryKey(),
 year: integer("year").notNull(), make: text("make").notNull(), model: text("model").notNull(),
 display_model: text("display_model").notNull(), configuration_hint: text("configuration_hint"),
 source_name: text("source_name").notNull(), source_url: text("source_url"),
 review_status: text("review_status").notNull().default("unreviewed"),
 imported_at: text("imported_at").notNull(), updated_at: text("updated_at").notNull(),
}, t => [index("inv_vehicle_reference_lookup").on(t.year,t.make,t.display_model), index("inv_vehicle_reference_raw_lookup").on(t.year,t.make,t.model)]);
