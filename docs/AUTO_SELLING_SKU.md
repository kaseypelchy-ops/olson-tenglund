# Automatic default selling SKU on supplier promotion

## Purpose
When a reviewed supplier row is promoted to a draft product, create a default **each** SKU if the product has no selling SKU. This works for new products, existing branded products, and previously linked supplier rows when **Ensure selling SKU** is clicked. No database migration is required.

## Rules
- SKU shape: `OT-{BRAND}-{MANUFACTURER-PART-NUMBER}-EA` using uppercased, sanitized, length-limited tokens. Example `OT-FRAM-XG12447-EA`.
- For identifiers that sanitize to an empty token, derive a stable hash from the product key.
- If a proposed SKU is used by a different product, append a stable hash suffix instead of overwriting or reassigning that SKU.
- If the target product has *any* existing SKU (including an archived one), do **not** create another. Staff should inspect/reactivate its existing SKU if needed. In particular, manually created SKUs remain untouched.
- For a new default SKU: `selling_unit=each`, `base_units_per_selling_unit_milli=1000`, `condition=new`, `reorder_point_milli=0`, `status=active`. Copy a source barcode only when one is present.
- Do not create prices, on-hand quantities, fitments, supplier offers, or publish the product. Staff should verify packaging and UPC before operational use.
- Promotion writes remain inside a single database transaction. Concurrent attempts are guarded against inserting an extra SKU for a product; retry if an identity collision is reported.

## Install
1. In the existing source folder, back up or commit current changes.
2. Copy patch files into their matching paths, overwriting only the listed files.
3. `npm.cmd run typecheck` then `npm.cmd run build`.
4. If checks pass: `git add .`, `git commit -m "Auto-create default selling SKU from supplier catalog"`, `git push origin main`.
5. Vercel redeploys on push when Git integration is enabled. No new environment variables or migration required.

## Test safely
- Review one **new TEST supplier record** and click **Create draft + SKU**. Confirm exactly one draft product plus one default SKU appears; no price or stock added.
- Click **Ensure selling SKU** again. Confirm the same SKU is preserved (no duplicate).
- For a previously linked product with a manually created SKU, click **Ensure selling SKU** and confirm it is not replaced.
- For a previously linked product with no SKU, click **Ensure selling SKU** and confirm a default SKU is added.
- Confirm published products and all previously recorded stock/fitments are unchanged.

## Important
This is an additive code patch intended for the supplier staging implementation delivered earlier. It has **not** been deployed to your GitHub/Vercel accounts. Run project checks locally before pushing.
