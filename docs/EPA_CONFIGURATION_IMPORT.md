# EPA vehicle configuration staging for Olson & Tenglund

This package is built from the user-supplied **FuelEconomy.gov `vehicles.csv`** (50,647 distinct EPA IDs; model years 1984–2027). It preserves source identifiers and source descriptions in an isolated table.

## Install

Copy the contents of this ZIP into the ROOT of the current Next.js project. This update assumes your repository already has migrations `0000` through `0004` applied and includes the Year/Make/Model reference library.

From the project root in PowerShell:

```powershell
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\olson-epa-configuration-update.zip" -DestinationPath (Get-Location).Path -Force
npm.cmd run db:migrate
node --env-file-if-exists=.env.local scripts/import-epa-configurations.mjs data/epa_vehicle_configurations.csv --dry-run
node --env-file-if-exists=.env.local scripts/import-epa-configurations.mjs data/epa_vehicle_configurations.csv
npm.cmd run typecheck
npm.cmd run build
```

The script uses the **same Turso environment variables** as the existing project. Check `.env.local` points to the intended database. Never post credentials. Import is idempotent on `epa_id`; rerunning it refreshes source fields and preserves manual match review status.

**No website release is required to run this local import script**, but commit the migration, importer, and documentation for reproducibility. Do not commit `.env.local`. If you do not want to check in the 6+ MB source data file, add it to `.gitignore` *after completing the import* and retain an offline copy.

## Data structure

`inv_vehicle_epa_config` stores EPA ID, Y/M/M, base model, displacement, cylinders, drivetrain, transmission, transmission description, fuel information, engine notes, turbo/supercharger flags, motor details, and source metadata.

**Candidate exact matches** use exact source year, make, and raw model spelling/capitalization to link to `inv_vehicle_reference`. No fuzzy guessing is performed. An exact match is **not** verification of the underlying configuration or fitment. The new table doesn't write to `inv_vehicles`, `inv_fitments`, or the public directory.

### Diagnostic SQL

```sql
SELECT COUNT(*) FROM inv_vehicle_epa_config;
SELECT year, make, model, engine_displacement_l, cylinders, transmission, drive, epa_id, match_status
  FROM inv_vehicle_epa_config WHERE year=2024 AND make='Buick' AND model LIKE 'Encore GX%';
SELECT match_status,COUNT(*) FROM inv_vehicle_epa_config GROUP BY match_status;
```

## Next steps

1. Build customer-facing configuration refinement linked to the garage *after checking normalization of model variants*.
2. Source licensed VCdb data for complete trim/body/vehicle identifiers; EPA is not enough.
3. Source Auto Value/manufacturer ACES data for verified part fitment; **do not use EPA source records as proof of compatibility**.
4. Keep the source files, generated import manifests, and licensing records.
