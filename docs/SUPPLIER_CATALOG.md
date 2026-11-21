# Auto Value / distributor product catalog staging

This feature prepares an **authorized** distributor product master feed for Olson & Tenglund. It is not connected to a proprietary Auto Value/MyPlace4Parts API and does not retrieve Auto Value data. Obtain product feeds and republication rights directly from Olson & Tenglund's Auto Value warehouse distributor.

## Deployment

1. Back up the project and confirm your Git checkout includes the vehicle-reference update (`0003_vehicle_reference_library.sql`).
2. Copy the updated files from this patch into the same project directory, preserving paths.
3. Ensure `.env.local` points to the **same hosted Turso database** as Vercel production. Never put credentials in Git.
4. Run `npm.cmd run db:migrate`. The new migration is `0004_supplier_feed_staging.sql`.
5. Run `npm.cmd run typecheck`, `npm.cmd run build` and your existing tests.
6. `git add . && git commit -m "Add supplier catalog staging" && git push origin main` and redeploy on Vercel.
7. Sign in to `/admin`, then select **Supplier catalog**.

## Import process

- Download the template in the supplier catalog page, or use the `supplier-catalog-example.csv` included with this patch.
- Required columns: `supplier_key`, `supplier_part_number`, `brand`, `manufacturer_part_number`, `title`, `source_name`.
- Optional: `category` (enum), `description`, `barcode`, `image_url` (HTTPS), `unit_cost_usd`, `suggested_retail_usd`, `source_reference`.
- Use a **stable warehouse/supplier key**, not a brand name. Replace `AUTO-VALUE` if the actual distributor provides a different unique identifier.
- Keep text identifiers as **strings**, even when consisting only of digits.
- Click **Validate full file**, then **Import to staging**. The browser processes at most 250 rows per request. A stopped import can safely be restarted; existing staging records are matched by normalized supplier key plus supplier part number.
- Validation is per row and per batch; the overall upload is not one transaction. Earlier batches stay committed if a later batch fails.
- Feed changes to core product identity or content reset the staged row to `unreviewed`. Cost-only updates remain staged and do not change retail price.
- Approve a staged record manually with **Mark reviewed**, then **Add draft product**. The product is created as a **draft**, with `fitment_mode=unknown` and `base_unit_code=each` until reviewed by staff.
- If a product with the same brand and manufacturer part number exists, the staging row **links to it** without changing the product. Existing Buick/FRAM records are preserved.
- No selling SKU, vehicle fitment, price rule, stock movement, or supplier offer is created automatically. Those need separate feed mappings and an approved business process.

## Safety/limitations

- Store cost and suggested retail are **internal staging values**, not published prices.
- Not a purchase-order or live-distributor availability feed.
- No automated image licensing checks. Use only images Olson & Tenglund is permitted to publish.
- Staging record changes do not overwrite already linked product records. They remain flagged for human review when updated.
- The source includes a simple category whitelist; map unfamiliar distributor categories before importing.
- A high-volume feed may need a server-side queued importer, retention policy, backoff, and per-batch monitoring after the supplier format and cadence are known.
- Current UI supports human review individually; bulk approval and auto-publish are deliberately not included.

## Next integration questions for Auto Value

1. Which actual warehouse distributor provides the feed and what unique identifier should be used?
2. Do they provide ACES/PIES files, CSV or a supported API, and is a license required to display products online?
3. How are changed/deleted/superseded products represented? What is the update cadence?
4. What fields describe selling units and package quantities? What product identifier is the retailer SKU?
5. Can per-location availability, negotiated costs, and images be redistributed to public customers?

Official references:
- https://www.autocare.org/aces
- https://pro.autovaluestores.com/my-place-4-parts/
- https://allianceconnect.com/integrations
