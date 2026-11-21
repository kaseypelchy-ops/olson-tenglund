CREATE TABLE IF NOT EXISTS inv_supplier_catalog_stage (
  stage_key TEXT PRIMARY KEY NOT NULL,
  supplier_key TEXT NOT NULL,
  supplier_part_number TEXT NOT NULL,
  brand TEXT NOT NULL,
  manufacturer_part_number TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT,
  barcode TEXT,
  image_url TEXT,
  unit_cost_cents INTEGER,
  suggested_retail_cents INTEGER,
  source_name TEXT NOT NULL,
  source_reference TEXT,
  review_status TEXT NOT NULL DEFAULT 'unreviewed',
  linked_product_key TEXT,
  last_imported_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  CHECK (review_status IN ('unreviewed','reviewed','rejected')),
  CHECK (category IN ('brakes','batteries','filters','oil','wipers','ignition','electrical','engine','suspension','drivetrain','tools','accessories','other')),
  CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  CHECK (suggested_retail_cents IS NULL OR suggested_retail_cents >= 0),
  FOREIGN KEY (linked_product_key) REFERENCES inv_products(product_key)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS inv_supplier_catalog_identity ON inv_supplier_catalog_stage (supplier_key,supplier_part_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inv_supplier_catalog_search ON inv_supplier_catalog_stage (brand,manufacturer_part_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inv_supplier_catalog_review ON inv_supplier_catalog_stage (review_status,linked_product_key);
