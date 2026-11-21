# Olson & Tenglund — Vehicle Reference Library update

This is an **additive update** to your existing Next.js / Turso project. It does not overwrite products, prices, stock, existing reviewed vehicle configurations, or fitment applications.

## What changes
- Adds the `inv_vehicle_reference` table with a new additive migration.
- Adds an authenticated **Year / make / model** page in `/admin` for uploading the complete EPA staging file in 250-row batches (one browser upload).
- Adds a public, **browse-only** `/vehicle-directory` route and a footer link. It explicitly does not promise fitment.
- Original year/make/model is preserved. Explicit AWD/FWD/RWD/4WD/2WD suffixes are suggested as separate configuration hints.
- Repeat uploads upsert matching year/make/original-model records and never turn them into verified fitment.

## Install on Windows PowerShell

1. **Back up or commit your current code first.** Download `olson-vehicle-reference-update.zip` into Downloads.
2. In PowerShell, change into the current repository folder (the folder containing `package.json`):

```powershell
Set-Location -LiteralPath "C:\Users\Kasey Pelchy\Downloads\olson-tenglund-vercel\olson-tenglund-vercel"
```

3. Extract the update **onto that folder** (this updates only the files included in the ZIP):

```powershell
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\olson-vehicle-reference-update.zip" -DestinationPath (Get-Location).Path -Force
```

4. Confirm your `.env.local` still points to the same **hosted Turso database** as your live Vercel app. Do not paste tokens in chat. Run the additive migration locally against that configured database **before deploying the new code**:

```powershell
npm.cmd run db:migrate
```

Expected: `Applied 0003_vehicle_reference_library.sql`; original migrations should be skipped. **Do not delete existing migrations or clear the database.**

5. Check the project and commit:

```powershell
npm.cmd run typecheck
npm.cmd run build
git status --short
git add .
git commit -m "Add bulk vehicle reference library and browse-only directory"
git push origin main
```

6. Deploy using your existing Vercel workflow. If GitHub is connected to your Vercel project, pushing to `main` typically triggers the deployment. Otherwise, from this linked folder use:

```powershell
npx.cmd vercel@latest --prod
```

7. Once the new deployment is live, sign into `https://olson-tenglund.vercel.app/admin` and open **Year / make / model**. Choose the original `epa_year_make_model_1984_2026_STAGING.csv`, not the 105 already split staging batches.
8. Leave the browser tab open until it says all records were processed. The importer sends 250-row transactions; re-uploading safely resumes if interrupted. Confirm a total of **26,049** reference entries.
9. Visit `https://olson-tenglund.vercel.app/vehicle-directory`. The public directory is intentionally browse-only. The existing verified vehicle finder and Buick/FRAM parts are unaffected.

## Rollback and safety

The migration **only adds a table and indexes**. Rolling back the UI code does not destroy the existing product data. Do not manually delete `inv_vehicle_reference` until you have explicitly confirmed the references are no longer needed. The import does not modify `inv_vehicles` or `inv_fitments`.

## Verification performed in the preparation environment

- Parsed the exact uploaded staging file: **26,049** rows in **105** batches, with zero repeated year/make/model identities.
- Tested additive SQL in SQLite, including all 26,049 reference inserts and safe repeat upsert preserving review status.
- TypeScript/TSX syntax transpilation passed for changed code.
- Full Next.js production build was **not** run in this environment because project npm dependencies were unavailable. Run `npm.cmd run typecheck` and `npm.cmd run build` locally before pushing.
