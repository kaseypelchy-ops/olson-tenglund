# Authorized fitment feed staging — Olson & Tenglund

This update adds a staff-only staging page and import workflow for authorized application data. It **does not** contain licensed Auto Value product application records, and it is **not** a complete ACES XML parser. It does **not** equate EPA configuration IDs with VCdb IDs. Do not upload generated or guessed fitments.

## Deployment

1. Commit or back up local changes.
2. Extract the ZIP into the existing Next.js project root.
3. Run `node scripts/register-fitment-migration.mjs`. This will **only** append migration 0006 if the local journal already contains migrations 0000–0005. If it fails, inspect journal history; don't bypass it.
4. Run `npm.cmd run db:migrate`. Verify `Applied 0006_fitment_feed_staging.sql`.
5. Run `npm.cmd run typecheck` and `npm.cmd run build`. Correct errors before pushing.
6. `git add .`, `git commit -m "Add authorized fitment application staging"`, `git push origin main`.
7. Visit `/admin/fitment-feed` while logged into the inventory workspace.

No public navigation is added. The staff-only page is available directly at `/admin/fitment-feed` to avoid replacing a newer version of `inventory-workspace.tsx` that may contain your previous supplier changes.

## Supported normalized CSV columns

`source_name,application_id,brand,manufacturer_part_number,vehicle_key,position,restrictions,source_reference`

- `source_name`: licensed source (e.g. name of authorized provider), not a made-up claim of authorization.
- `application_id`: immutable application identifier unique within the source. For multi-qualifier or multi-position rows, ensure each distinct application gets a unique identifier.
- `brand`, `manufacturer_part_number`: must match an existing product exactly after case/whitespace normalization.
- `vehicle_key`: **internal `inv_vehicles.vehicle_key`**, not the EPA `epa_id`, not a reference key, not a VCdb `BaseVehicleID` by itself. Leave blank until a trustworthy VCdb-to-internal vehicle mapping is established.
- `position`: source-specified position (front/rear etc.).
- `restrictions`: preserve **all** supplier application qualifiers; do not discard qualifiers. Draft fitments start with `restriction_status='unresolved'` regardless of this field.
- `source_reference`: persistent citation to original provider's application record/file/version.

Upload through `/admin/fitment-feed`. Validates all rows then stages in batches of 250. Reimports are idempotent based on source and application ID. Reimporting a materially changed unlinked row resets manual review. **Linked staged rows are frozen** to avoid silently altering draft fitments; reconcile changed application versions in a controlled review process.

## Required review sequence

1. Import authorized normalized CSV. No stock, price, vehicle, or product changes occur.
2. For each row, check supplier rights and original application, validate qualifiers, and map its `vehicle_key` to an existing exact configuration in **Verified Vehicles**. EPA engine/drivetrain candidate records are not sufficient.
3. Ensure product exists and has `fitment_mode='vehicle_specific'`.
4. Mark the staged row Reviewed; choose Create draft. The system creates a record in `inv_fitments` with `review_status='draft'` and `restriction_status='unresolved'`.
5. Open Inventory Workspace → Fitment applications, confirm vehicle configuration review, resolve qualifiers, then verify manually using the original evidence. Only then can it qualify for public fitment results.

## ACES feed caveats

ACES applications can depend on `BaseVehicleID`, `SubModelID`, `EngineBaseID`, region, position, and coded Qdb qualifiers. A raw `BaseVehicleID` alone is **not** a sufficient exact vehicle match. Transform a licensed ACES feed into the above staging format only after obtaining VCdb/Qdb reference data and matching every relevant attribute. Keep unresolved applications out of verified output.

Auto Care: https://www.autocare.org/aces
VCdb: https://www.autocare.org/data-and-information/data-standards/databases/vehicle-configuration-database-vcdb
Qdb: https://www.autocare.org/data-and-information/data-standards/databases/qualifier-database-qdb

## Database impact

Adds one `inv_fitment_feed_stage` table and three indexes. Existing `inv_fitments`, `inv_vehicles`, `inv_vehicle_reference`, `inv_vehicle_epa_config`, `inv_products`, SKUs, prices, and stock are unchanged by import. Draft promotion inserts only into existing `inv_fitments` plus audit fields.

## Important limitation

This is **phase 1** of the full Auto Value compatibility integration. The source data and licensed translation for VCdb/Qdb are still required. Homepage Find Parts remains intentionally unfiltered by EPA guesses. Once real source records are verified, the existing catalog service already supports filtering by verified `vehicle_key`; connecting the garage's selected EPA configuration to the correct VCdb/verified vehicle requires a separate explicit crosswalk.
