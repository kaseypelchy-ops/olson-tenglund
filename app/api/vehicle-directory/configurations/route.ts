import { apiHandler, getDatabase } from "@/lib/inventory/server";
import { InventoryError } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** EPA configurations are descriptive candidates, never verified parts fitment. */
export async function GET(request: Request) {
  return apiHandler(request, async () => {
    const key = new URL(request.url).searchParams.get("referenceKey") || "";
    if (!/^[a-f0-9]{64}$/.test(key)) throw new InventoryError("Choose a valid Year / Make / Model entry.", 422);
    const db = getDatabase();
    const reference = await db.prepare("SELECT reference_key FROM inv_vehicle_reference WHERE reference_key=?").bind(key).first<Record<string, unknown>>();
    if (!reference) throw new InventoryError("This vehicle is not available in the reference directory.", 404);
    const result = await db.prepare(`SELECT epa_id, engine_displacement_l, cylinders, engine_description,
      drive, transmission, transmission_description, fuel_type_primary, fuel_type,
      electric_motor, vehicle_class, match_status
      FROM inv_vehicle_epa_config WHERE reference_key=? AND match_status IN ('candidate_exact','reviewed')
      ORDER BY engine_displacement_l, cylinders, engine_description, drive, transmission, epa_id
      LIMIT 1001`).bind(key).all<Record<string, unknown>>();
    if (result.results.length > 1000) throw new InventoryError("This vehicle has too many configurations to display. Contact the parts counter.", 422);
    return { source: "EPA FuelEconomy.gov", verification: "configuration candidate, not verified fitment", configurations: result.results.map(r => ({
      epa_id: Number(r.epa_id), engine_displacement_l: r.engine_displacement_l == null ? null : Number(r.engine_displacement_l),
      cylinders: r.cylinders == null ? null : Number(r.cylinders),
      engine_description: r.engine_description == null ? null : String(r.engine_description),
      drive: r.drive == null ? null : String(r.drive),
      transmission: r.transmission == null ? null : String(r.transmission),
      transmission_description: r.transmission_description == null ? null : String(r.transmission_description),
      fuel_type_primary: r.fuel_type_primary == null ? null : String(r.fuel_type_primary),
      fuel_type: r.fuel_type == null ? null : String(r.fuel_type),
      electric_motor: r.electric_motor == null ? null : String(r.electric_motor),
      vehicle_class: r.vehicle_class == null ? null : String(r.vehicle_class)
    })) };
  });
}
