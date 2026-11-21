-- Supplemental EPA configuration records. NOT verified VCdb or parts fitment.
CREATE TABLE inv_vehicle_epa_config (
 epa_id INTEGER PRIMARY KEY NOT NULL,
 year INTEGER NOT NULL,
 make TEXT NOT NULL,
 model TEXT NOT NULL,
 base_model TEXT,
 drive TEXT,
 transmission TEXT,
 transmission_description TEXT,
 engine_displacement_l REAL,
 cylinders INTEGER,
 fuel_type TEXT,
 fuel_type_primary TEXT,
 vehicle_class TEXT,
 engine_description TEXT,
 turbo TEXT,
 supercharger TEXT,
 alternative_vehicle_type TEXT,
 electric_motor TEXT,
 manufacturer_code TEXT,
 reference_key TEXT,
 match_status TEXT NOT NULL DEFAULT 'unmatched',
 source_name TEXT NOT NULL DEFAULT 'EPA FuelEconomy.gov vehicles.csv',
 imported_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK(year BETWEEN 1886 AND 2100),
 CHECK(match_status IN ('unmatched','candidate_exact','reviewed','rejected')),
 FOREIGN KEY (reference_key) REFERENCES inv_vehicle_reference(reference_key)
);
--> statement-breakpoint
CREATE INDEX inv_vehicle_epa_lookup ON inv_vehicle_epa_config(year,make,model);
--> statement-breakpoint
CREATE INDEX inv_vehicle_epa_reference ON inv_vehicle_epa_config(reference_key,match_status);
--> statement-breakpoint
CREATE INDEX inv_vehicle_epa_review ON inv_vehicle_epa_config(match_status);
