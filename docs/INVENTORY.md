# Inventory and catalog guide

## Available workflows

| Surface | Purpose |
| --- | --- |
| `/admin` | Staff overview, setup checklist, record management and recent activity |
| `/admin#products` | Product identities, sources, draft status and publication review |
| `/admin#imports` | CSV templates, upload/paste, mapping, validation and import history |
| `/admin#stock` | SKU/location balances and recorded stock adjustments |
| `/` | Customer-facing storefront using published catalog data |

The console manages ten record types: **products, part specifications, selling SKUs, vehicle configurations, fitment applications, suppliers, supplier offers, locations, prices and business accounts**. It includes search, pagination, create/edit forms, reference lookups and optimistic revision checks. Stable keys cannot be renamed after creation.

`opening_stock` is an additional **import-only** type. It records opening counts through the stock workflow; it is not a separate editable count table.

### Product and quantity model

- A product represents the branded part. Keep its part brand and manufacturer part number distinct from a vehicle make or supplier ordering number.
- A selling SKU represents a unit or package sold for that product. Several packaging SKUs can refer to one product.
- Each product defines a canonical base unit. `base_units_per_selling_unit` converts one SKU selling unit into product base units; fitment quantities use that product base unit.
- Stock movements, balances, reorder points and prices use the SKU's selling unit. Do not count the same goods once as cases and again as individual units.
- Specifications belong to the product. Vehicle applications are separate relationships; another application does not create another stock balance.
- Supplier availability is dated sourcing information and never increases local stock automatically.

Money is stored in integer cents and quantity values in integer thousandths. Excess decimal precision is rejected rather than silently rounded.

## First-use sequence

Start with a small set of real, well-documented parts and complete their connected records before importing a large catalog.

| Create first | Then add |
| --- | --- |
| Products | Selling SKUs and product specifications |
| Selling SKUs | Retail, trade or named-list prices |
| Products and vehicle configurations | Fitment applications |
| Suppliers and selling SKUs | Supplier offers |
| Selling SKUs and locations | Opening stock counts |
| Consistent price-list keys | Business-account price-list assignments |

For a manual start, save a product draft, create its SKU, add specifications and pricing, then enter a location and opening stock. Add vehicle applications from supported source information. Unknown details and unresolved restrictions remain unknown; missing fields do not imply unrestricted fitment.

New and imported products remain drafts. Open an existing product to review its readiness issues. After addressing them, explicitly choose storefront visibility and save. The server checks publication prerequisites.

### Stock controls

Use **Stock & locations → Adjust stock** to add or remove a quantity, select its disposition and record a reason. For opening stock, add the counted quantity once. For a later correction, enter the difference being added or removed, not the new total.

Sellable, damaged, quarantine and core quantities remain separate. Opening-stock imports accept only positions with no existing stock history; they cannot overwrite live balances. Keep the count key and reason for traceability. Counts are not order reservations.

The stock page defaults to **All locations**. Choosing a location filters its rows, total count, summary and pagination together. Products and selling SKUs are shared across the three stores; each store keeps separate stock balances. A store with no recorded stock is not assumed to have another store’s quantity.

Location records include optional street address, city, state, ZIP code, phone and store hours. Confirm these details before filling them in. Active store records expose their contact information on the storefront; internal location notes remain staff-only. The admin form separates location basics, store contact/hours and internal notes. The explicit `npm run db:seed-locations` command creates the three initial stores once and preserves existing records. Application startup never seeds or duplicates stores.

## CSV imports

1. Select a record type and download its blank CSV template.
2. Add real records. Preserve keys, barcodes and part numbers as text, then export UTF-8 CSV with one header row.
3. Upload or paste the CSV and match source columns to destination fields.
4. Validate on the server. Review normalized records and row errors; download the error CSV when corrections are needed.
5. Explicitly apply a valid batch. The server uses its saved staging data and revalidates against current records.

Import rules:

- **CSV only, maximum 250 data rows per batch.** The upload limit is 2 MB; the parser also bounds text size. XLSX, ACES and PIES files are not accepted by this generic importer.
- Imports are **create-only**. Existing keys and duplicates produce errors, not implicit updates.
- The whole batch must be valid. Application is atomic, with no silent partial import.
- Dependencies must already exist. Import products before SKUs, and SKUs/locations before opening counts.
- Products import as drafts. Imported vehicle configurations and applications still need their respective reviews.
- History records staged and applied batches. Error CSV downloads escape spreadsheet-formula prefixes; source values remain available for validation.

## Storefront behavior and limits

The storefront reads published catalog records through `/api/catalog`. Draft products and an empty catalog do not become sample inventory. Vehicle matching depends on the actual records supplied and reviewed by staff.

The browser cart is an **order list**. Quantity controls, copy/download actions and job references do not submit an order, reserve stock, process payments or promise fulfillment. Shop inquiries prepare local drafts; they do not create customer logins or automatically send an application.

The visual direction and retained thematic imagery are design assets, not actual-stock evidence or photographs of the premises. Confirm approved branding, contact details, photography, policies and fulfillment terms before a public launch. No current supplier affiliation is assumed.

