# Homepage My Garage picker update

This patch replaces the disabled homepage vehicle selector. It uses the SAME endpoints as the existing My Garage page:

- `GET /api/vehicle-directory` for years and makes
- `GET /api/vehicle-directory/options?year=...&make=...` for model reference IDs
- `GET /api/vehicle-directory/configurations?referenceKey=...` for EPA configuration candidates

The picker saves to the existing `olson-tenglund.garage.v1` localStorage key using the same `reference_key:epa_id` active-key convention as My Garage. It creates no new database tables. The exact EPA ID is saved when one is available. If there is no linked EPA configuration, the user can save the Year/Make/Model reference alone.

**Safety boundary:** EPA configurations are not verified parts fitment. The homepage does not pass EPA IDs to `/api/catalog` as verified `vehicle_key` filters. The button saves the vehicle and browses all products, displaying a compatibility disclaimer. A customer must confirm application with the parts counter or future licensed fitment integration.

## Install

1. Make sure previous Vehicle Reference Library, EPA configuration, My Garage and corresponding API updates are already deployed.
2. Back up local changes, then overlay the two `public/storefront/` files at the project root.
3. Run `node --check public/storefront/app.js`, `npm.cmd run typecheck`, `npm.cmd run build`.
4. Commit and push to GitHub. Confirm Vercel deployment is Ready.
5. Hard-refresh homepage, choose a Year / Make / Model / configuration, select **Save & browse parts**, and open **Manage My Garage**. The active vehicle and EPA ID should match on both pages.

## Notes

- No database migration is required.
- Browser localStorage is device-specific; vehicle lists do not yet synchronize to user accounts.
- If a model has no EPA matches, it can still be saved as a reference-only garage vehicle.
- The homepage uses one combined Engine / Drivetrain / Transmission dropdown to avoid invalid combinations and preserve the existing layout. The dedicated My Garage page offers separate engine, drivetrain, and transmission controls.
- The patch uses existing model/reference APIs and does not modify other inventory or administrative code.
- This package is based on the previously supplied storefront patch. If you have subsequently changed `public/storefront/app.js` or `public/storefront/index.html`, merge these changes rather than blindly overwriting them.
