import { createHash, randomUUID } from "node:crypto";
import { getDatabase, getActor, readJson } from "./server";
import { InventoryError } from "./validation";

export type VehicleReferenceInput = { year: unknown; make: unknown; model: unknown; source?: unknown; review_status?: unknown; source_url?: unknown };
const safe = (v: unknown) => typeof v === "string" ? v.trim() : (v == null ? "" : String(v).trim());
const norm = (v: string) => v.replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
export function normalizeVehicleReference(input: VehicleReferenceInput) {
  const year = Number(input.year), make = safe(input.make), model = safe(input.model);
  if (!Number.isInteger(year) || year < 1886 || year > 2100) throw new Error("Year must be between 1886 and 2100.");
  if (!make || !model || make.length > 130 || model.length > 200) throw new Error("Make and model must be present and reasonably sized.");
  const source = safe(input.source) || "Unspecified reference source";
  if (source.length > 200) throw new Error("Source name is too long.");
  const url = safe(input.source_url);
  if (url && (!/^https:\/\//i.test(url) || url.length > 600)) throw new Error("Source URL must be an HTTPS URL.");
  // EPA models sometimes encode a drivetrain suffix. Keep the exact source model
  // and expose a suggested display label separately. Do not mark as verified.
  const suffix = /\s+(AWD|FWD|RWD|4WD|2WD)$/i.exec(model);
  const display = suffix ? model.slice(0, suffix.index).trim() : model;
  const key = createHash("sha256").update(`${year}|${norm(make)}|${norm(model)}`).digest("hex");
  return { reference_key: key, year, make, model, display_model: display, configuration_hint: suffix ? suffix[1].toUpperCase() : null,
    source_name: source, source_url: url || null, review_status: "unreviewed" as const };
}
export async function importVehicleReferenceBatch(request: Request) {
  const payload = await readJson(request);
  if (!Array.isArray(payload.rows) || !payload.rows.length || payload.rows.length > 250) throw new InventoryError("Send 1–250 vehicle-reference records per batch.", 422);
  const incoming = payload.rows as VehicleReferenceInput[];
  const records: ReturnType<typeof normalizeVehicleReference>[] = [];
  const keys = new Set<string>();
  const errors: { row: number; message: string }[] = [];
  for (let i = 0; i < incoming.length; i++) {
    try {
      const parsed = normalizeVehicleReference(incoming[i]);
      if (keys.has(parsed.reference_key)) continue;
      keys.add(parsed.reference_key); records.push(parsed);
    } catch (e) { errors.push({ row: i + 1, message: e instanceof Error ? e.message : "Invalid reference record." }); }
  }
  if (errors.length) throw new InventoryError("Batch rejected. Fix the invalid records and retry; no rows were saved.", 422, "invalid_vehicle_reference", errors);
  const actor = getActor(request), db = getDatabase(), now = new Date().toISOString();
  const statements = records.map(r => db.prepare(`INSERT INTO inv_vehicle_reference
    (reference_key,year,make,model,display_model,configuration_hint,source_name,source_url,review_status,imported_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(reference_key) DO UPDATE SET
    source_name=excluded.source_name, source_url=excluded.source_url,
    display_model=excluded.display_model, configuration_hint=excluded.configuration_hint,
    updated_at=excluded.updated_at`).bind(r.reference_key,r.year,r.make,r.model,r.display_model,r.configuration_hint,r.source_name,r.source_url,r.review_status,now,now));
  statements.push(db.prepare(`INSERT INTO inv_audit_log (id,action,entity,record_key,summary,actor,created_at) VALUES (?,?,?,?,?,?,?)`).bind(randomUUID(),"import","vehicle_reference",null,`Processed ${records.length} year/make/model reference rows`,actor,now));
  await db.batch(statements);
  return { processed: records.length, ignoredWithinBatch: incoming.length - records.length, status: "committed", verifiedFitmentsChanged: 0 };
}
export async function listVehicleReferences(request: Request) {
  const url = new URL(request.url), params = url.searchParams;
  const year = params.get("year") || "", make = params.get("make") || "", q = params.get("q")?.trim() || "";
  const page = Math.min(100000,Math.max(1,Number(params.get("page")) || 1));
  if (q.length > 120) throw new InventoryError("Search term is too long.",422);
  const conditions: string[] = [], values: (string | number)[] = [];
  if (year) { const y = Number(year); if (!Number.isInteger(y) || y < 1886 || y > 2100) throw new InventoryError("Invalid year filter.",422); conditions.push("year = ?"); values.push(y); }
  if (make) { conditions.push("make = ?"); values.push(make); }
  if (q) { conditions.push("(model LIKE ? ESCAPE '\\' OR display_model LIKE ? ESCAPE '\\')"); const val = `%${q.replace(/[\\%_]/g, "\\$&")}%`; values.push(val,val); }
  const where = conditions.length ? " WHERE "+conditions.join(" AND ") : "";
  const db = getDatabase();
  const get = async (sql: string, args: (string | number)[]=[]) => (await db.prepare(sql).bind(...args).all<Record<string, unknown>>()).results;
  const [rows,count,years,makeOptions] = await Promise.all([
    get(`SELECT reference_key,year,make,model,display_model,configuration_hint,review_status,source_name FROM inv_vehicle_reference${where} ORDER BY year DESC,make,display_model LIMIT 50 OFFSET ?`, [...values,(page-1)*50]),
    get(`SELECT COUNT(*) AS total FROM inv_vehicle_reference${where}`,values),
    get("SELECT DISTINCT year FROM inv_vehicle_reference ORDER BY year DESC"),
    year ? get("SELECT DISTINCT make FROM inv_vehicle_reference WHERE year=? ORDER BY make",[Number(year)]) : Promise.resolve([]),
  ]);
  return { records:rows, total:Number(count[0]?.total||0), page, pageSize:50, years:years.map(r=>Number(r.year)), makes:makeOptions.map(r=>String(r.make)) };
}
