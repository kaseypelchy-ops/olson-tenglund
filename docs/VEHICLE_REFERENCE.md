# Vehicle reference library (separate from verified fitments)

This feature imports broad **year / make / model reference records**, not complete vehicle configurations.

## Deploy
1. Upload the updated source files to GitHub and deploy on Vercel.
2. In the project directory on your own computer, with `.env.local` pointing at the **same Turso database used by production**, run `npm.cmd run db:migrate` (PowerShell). It should apply `0003_vehicle_reference_library.sql`.
3. Sign in at `/admin`, open **Year / make / model** and choose `epa_year_make_model_1984_2026_STAGING.csv`.
4. Keep the browser tab open while the batches process. The client sends 250 rows per request; rerunning is safe because year/make/original-model identities upsert rather than duplicate.
5. Filter the resulting library by year and make. These references do **not** populate verified fitment results or cause a product to appear for that vehicle on the storefront.

## Data model
- Stable `reference_key`: SHA-256 of year, lowercased/whitespace-normalized make, and **original** model.
- Source model is immutable for identity; `display_model` removes only an explicit trailing AWD/FWD/RWD/2WD/4WD marker and saves the extracted hint.
- `review_status` always enters as `unreviewed`, and reimports do not elevate it.
- No connection to `inv_fitments` or `inv_vehicles`; your existing verified Buick/FRAM test records are unaffected.
- The public `/vehicle-directory` page offers a separate year/make/model browse-only directory with an explicit no-fitment disclaimer. The storefront’s actual vehicle fitment selector remains verified-only.

## Limitations
- EPA FuelEconomy coverage is 1984–2026 in this staging file, not all vehicles or 1980–1983.
- The import client assumes the generated EPA staging CSV has one CSV record per physical line (no multiline quoted cells).
- Large imports consist of many transactions (one per 250 rows), not one global transaction; rerun to resume from the start.
- Upserts refresh source fields but not review status; they never delete missing records.
- Do not confuse these reference rows with Auto Value/ACES/VCdb authoritative fitments.
