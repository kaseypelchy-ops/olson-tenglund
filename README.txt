Olson & Tenglund Year/Make/Model database repair

Contains: 26,049 EPA-derived Year/Make/Model rows and a direct Turso import script.
Use only after checking the target database. The script requires a nonempty EPA configuration table.

From project root (after extracting ZIP into the project root):
node --env-file-if-exists=.env.local scripts/restore-vehicle-references.mjs data/vehicle_references.csv --dry-run
node --env-file-if-exists=.env.local scripts/restore-vehicle-references.mjs data/vehicle_references.csv

The script uses createConfiguredClient in db/libsql.mjs, the same module used by the existing EPA import.
It upserts reference rows, preserving existing review statuses, and attempts exact-match candidate links to EPA configs.
No schema migration, verified vehicle, product, SKU or fitment changes.

Important: EPA data is a broad directory, not a complete OEM configuration or parts-application catalog.
