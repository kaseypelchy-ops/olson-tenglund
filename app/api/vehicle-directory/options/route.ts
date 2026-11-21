import { apiHandler, getDatabase } from "@/lib/inventory/server";
import { InventoryError } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Browse-only reference choices, not verified vehicle configurations. */
export async function GET(request: Request) {
  return apiHandler(request, async () => {
    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year"));
    const make = (url.searchParams.get("make") ?? "").trim();
    if (!Number.isInteger(year) || year < 1886 || year > 2100) throw new InventoryError("Select a valid year.", 422);
    if (!make || make.length > 130) throw new InventoryError("Select a valid make.", 422);
    const db = getDatabase();
    const rows = (await db.prepare(`SELECT reference_key, year, make, model, display_model, configuration_hint
      FROM inv_vehicle_reference WHERE year = ? AND make = ?
      ORDER BY display_model COLLATE NOCASE, model COLLATE NOCASE LIMIT 2001`).bind(year, make).all<Record<string, unknown>>()).results;
    // Protect response size. If the reference source exceeds the limit, require a narrower curated feed.
    if (rows.length > 2000) throw new InventoryError("Too many models for this make/year. Contact the parts counter.", 422);
    return { models: rows.map(r => ({
      reference_key: String(r.reference_key), year: Number(r.year), make: String(r.make),
      model: String(r.model), display_model: String(r.display_model),
      configuration_hint: r.configuration_hint == null ? null : String(r.configuration_hint)
    })) };
  });
}
