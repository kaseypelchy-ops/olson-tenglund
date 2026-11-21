# My Garage EPA Configuration Picker

Additive update: three files only. No schema migration; requires existing migration `0005_epa_vehicle_config_staging.sql` plus populated `inv_vehicle_reference` and `inv_vehicle_epa_config`.

## Install

1. Back up / commit any uncommitted code in your local repository.
2. Overlay the ZIP into the existing Next.js repository directory. This replaces `app/vehicle-directory/page.tsx` and `public/storefront/app.js` and adds `app/api/vehicle-directory/configurations/route.ts`.
3. Run `npm.cmd run typecheck` and `npm.cmd run build` locally.
4. Commit and push to your `main` branch if both pass; confirm Vercel Ready.

## Customer behavior

- Choose Year, Make, Model from `inv_vehicle_reference`.
- App requests linked EPA configuration rows where match_status = `candidate_exact` or `reviewed`.
- Choose Engine/Fuel, Drivetrain, Transmission. Each stage derives choices from matching real EPA rows, never an invented cross-product.
- Configuration is saved in the existing browser localStorage garage. Data includes `epa_id` and a descriptive `configuration_label`. A model without a linked EPA configuration can still be saved as Year/Make/Model only with a warning.
- Multiple EPA configurations can be saved for one Year/Make/Model. Older browser-saved Year/Make/Model vehicles remain readable.
- The storefront shows the active saved configuration's description, but **does not filter parts based on EPA records**. No fitments, verified vehicles, pricing, or stock are created or changed.

## Test

1. Open `/vehicle-directory` and choose 2024 / Buick / Encore GX (select the actual model available in the reference directory).
2. Choose one offered engine, drivetrain, and transmission; save.
3. Save a second configuration for the same reference model, if offered. Verify switching active vehicle and removing each works.
4. Visit `/` and confirm the active vehicle is shown in the vehicle label.
5. Reload and verify local garage persists.
6. Try a vehicle without linked EPA records. It should permit reference-only saving and explicitly warn that no configuration data is linked.

## Data quality and constraints

EPA FuelEconomy.gov configurations are NOT standardized Auto Care VCdb vehicle configurations, and EPA matching is a candidate reference link, not verified parts compatibility. EPA configuration fields can be empty; the picker displays an honest missing-data label. Trim and exact VIN decoding are out of scope. Vehicle-specific fitment must still use reviewed `inv_vehicles` and verified `inv_fitments`.

Account-based syncing between devices is not implemented. No live database changes are performed by the patch itself.
