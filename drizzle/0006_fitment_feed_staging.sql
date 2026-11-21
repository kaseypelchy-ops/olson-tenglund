-- Licensed application-data staging. Import does not make a fitment public.
CREATE TABLE inv_fitment_feed_stage (
 stage_key TEXT PRIMARY KEY NOT NULL,
 source_name TEXT NOT NULL,
 application_id TEXT NOT NULL,
 brand TEXT NOT NULL,
 manufacturer_part_number TEXT NOT NULL,
 vehicle_key TEXT,
 position TEXT,
 restrictions TEXT,
 source_reference TEXT NOT NULL,
 review_status TEXT NOT NULL DEFAULT 'unreviewed',
 linked_product_key TEXT,
 linked_fitment_key TEXT,
 last_imported_at TEXT NOT NULL,
 reviewed_at TEXT,
 reviewed_by TEXT,
 CHECK(review_status IN ('unreviewed','reviewed','rejected')),
 FOREIGN KEY (linked_product_key) REFERENCES inv_products(product_key),
 FOREIGN KEY (linked_fitment_key) REFERENCES inv_fitments(fitment_key)
);
--> statement-breakpoint
CREATE UNIQUE INDEX inv_fitment_stage_source_identity ON inv_fitment_feed_stage(source_name,application_id);
--> statement-breakpoint
CREATE INDEX inv_fitment_stage_review ON inv_fitment_feed_stage(review_status,linked_fitment_key);
--> statement-breakpoint
CREATE INDEX inv_fitment_stage_part ON inv_fitment_feed_stage(brand,manufacturer_part_number);
