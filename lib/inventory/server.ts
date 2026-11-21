import { getDatabase as getConfiguredDatabase } from "@/db/connection";
import { DatabaseConfigurationError } from "@/db/libsql.mjs";
import type { SqlDatabase, SqlStatement } from "@/db/contracts";
import { requireAdminActor } from "@/lib/auth";
import { ENTITY_DEFS, ENTITY_LIST, STOCK_DISPOSITIONS, isEntityName, type EntityName } from "./entities";
import { InventoryError, fromStorage, normalizeRecord, parseScaled, quoteIdentifier as qi, storageColumn, toStorage, type CleanRecord } from "./validation";

type Row = Record<string, unknown>;
type Bound = string | number | null;
export interface CheckedRow { row: number; record: CleanRecord; errors: string[]; }
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const quoted = qi;
export const getDatabase = getConfiguredDatabase;
export function entityTable(entity: EntityName): string { if (!isEntityName(entity) || ENTITY_DEFS[entity].importOnly) throw new InventoryError("This entity is available through imports only."); return qi("inv_" + entity); }
function entityName(value: unknown, allowImportOnly = false): EntityName { if (!isEntityName(value) || (!allowImportOnly && ENTITY_DEFS[value].importOnly)) throw new InventoryError("Choose a supported inventory record type."); return value; }
const bind = (db: SqlDatabase, sql: string, values: Bound[] = []) => db.prepare(sql).bind(...values);
async function rows(db: SqlDatabase, sql: string, values: Bound[] = []): Promise<Row[]> { return (await bind(db, sql, values).all<Row>()).results || []; }
async function one(db: SqlDatabase, sql: string, values: Bound[] = []): Promise<Row | null> { return bind(db, sql, values).first<Row>(); }
function chunks<T>(items: T[], size = 70): T[][] { const output: T[][] = []; for (let i = 0; i < items.length; i += size) output.push(items.slice(i, i + size)); return output; }
function unique(values: unknown[]): string[] { return [...new Set(values.filter(v => v !== null && v !== undefined && String(v).trim()).map(String))]; }
const lower = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("en-US");
const identity = (...values: unknown[]) => values.map(lower).join("\u001f");
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

// Only adminHandler can attach an actor after server-side session and role
// verification. Client-supplied identity headers never authorize a request.
const verifiedActors = new WeakMap<Request, string>();
export function getActor(request: Request): string {
  const actor = verifiedActors.get(request);
  if (!actor) throw new InventoryError("Sign in with an authorized staff account.", 401, "auth_required");
  return actor;
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) throw new InventoryError("Send JSON with Content-Type: application/json.", 415);
  const text = await request.text(); if (text.length > 1_000_000) throw new InventoryError("This request is too large. Use smaller batches (maximum 250 rows and 1 MB).", 413);
  try { const body = JSON.parse(text); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); return body; } catch { throw new InventoryError("The request must contain a valid JSON object."); }
}
export async function apiHandler(_request: Request, callback: () => Promise<unknown>): Promise<Response> {
  try {
    const result = await callback();
    return Response.json(result, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    let status = 500, code = "inventory_error", message = "The inventory request could not be completed. Please retry; no success is assumed.", details: unknown;
    if (error instanceof InventoryError) { status = error.status; code = error.code; message = error.message; details = error.details; }
    else if (error instanceof DatabaseConfigurationError) { status = error.status; code = error.code; message = error.message; }
    else if (error instanceof Error) {
      if (/no such table|no such column/i.test(error.message)) { status = 503; code = "database_not_ready"; message = "Inventory database setup is incomplete. Ask the site owner to apply the latest migration."; }
      else if (/UNIQUE constraint/i.test(error.message)) { status = 409; code = "duplicate_record"; message = "A record with this key or unique identity already exists. Refresh and review the existing record."; }
      else if (/FOREIGN KEY constraint/i.test(error.message)) { status = 409; code = "missing_reference"; message = "A linked record is missing. Create the referenced product, SKU, vehicle, supplier, or location first."; }
      else if (/CHECK constraint|NOT NULL constraint/i.test(error.message)) { status = 409; code = "data_conflict"; message = "The change conflicts with an inventory rule or a concurrent update. Refresh and review the data."; }
      console.error("Inventory API error", error.message.slice(0, 500));
    }
    return Response.json({ error: { code, message, ...(details ? { details } : {}) }, message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
export async function adminHandler(request: Request, callback: () => Promise<unknown>, write = false): Promise<Response> {
  return apiHandler(request, async () => {
    const actor = await requireAdminActor(request);
    verifiedActors.set(request, actor);
    try {
      if (write) { const origin = request.headers.get("origin"); if (!origin || origin !== new URL(request.url).origin) throw new InventoryError("This write must come from the inventory workspace on the same site.", 403, "origin_rejected"); }
      return await callback();
    } finally { verifiedActors.delete(request); }
  });
}
export function auditStatement(db: SqlDatabase, action: string, entity: string, key: string | null, summary: string, actor: string, onlyAfterChange = false): SqlStatement {
  return bind(db, `INSERT INTO inv_audit_log (id,action,entity,record_key,summary,actor,created_at) SELECT ?,?,?,?,?,?,?${onlyAfterChange ? " WHERE changes()>0" : ""}`, [uid(), action, entity, key, summary.slice(0, 1000), actor, now()]);
}
export function importSummary(row: Row): Row { let summary: unknown = {}; try { summary = JSON.parse(String(row.summary_json)); } catch {} return { id: row.id, entity: row.entity, filename: row.filename, status: row.status, validCount: Number(row.valid_count), errorCount: Number(row.error_count), totalCount: Number(row.total_count), created_at: row.created_at, applied_at: row.applied_at ?? null, summary }; }

async function loadByKeys(db: SqlDatabase, entity: EntityName, keys: string[]): Promise<Row[]> {
  const result: Row[] = []; const key = ENTITY_DEFS[entity].idField;
  for (const batch of chunks(unique(keys))) result.push(...await rows(db, `SELECT * FROM ${entityTable(entity)} WHERE ${qi(key)} IN (${batch.map(() => "?").join(",")})`, batch));
  return result;
}
async function loadByTuples(db: SqlDatabase, entity: EntityName, columns: string[], tuples: string[][]): Promise<Row[]> {
  const result: Row[] = []; const seen = new Set<string>(); const distinct = tuples.filter(t => { const key = JSON.stringify(t); if (seen.has(key)) return false; seen.add(key); return true; });
  for (const batch of chunks(distinct, 25)) result.push(...await rows(db, `SELECT * FROM ${entityTable(entity)} WHERE ${batch.map(() => "(" + columns.map(c => `${qi(c)}=?`).join(" AND ") + ")").join(" OR ")}`, batch.flat()));
  return result;
}
interface ValidationContext { existing: Map<string, Row>; references: Map<EntityName, Map<string, Row>>; identities: Row[]; prices: CleanRecord[]; openingPositions: Set<string>; openingKeys: Set<string>; }
const positionKey = (sku: unknown, location: unknown, disposition: unknown) => [sku, location, disposition].join("|");
async function validationContext(db: SqlDatabase, entity: EntityName, records: CleanRecord[]): Promise<ValidationContext> {
  const context: ValidationContext = { existing: new Map(), references: new Map(), identities: [], prices: [], openingPositions: new Set(), openingKeys: new Set() };
  const def = ENTITY_DEFS[entity];
  if (!def.importOnly) for (const r of await loadByKeys(db, entity, unique(records.map(r => r[def.idField])))) context.existing.set(String(r[def.idField]), r);
  const refEntities = [...new Set(def.fields.filter(f => f.reference).map(f => f.reference!))];
  for (const ref of refEntities) {
    const fields = def.fields.filter(f => f.reference === ref); const keys = unique(records.flatMap(r => fields.map(f => r[f.key])));
    context.references.set(ref, new Map((await loadByKeys(db, ref, keys)).map(r => [String(r[ENTITY_DEFS[ref].idField]), r])));
  }
  if (entity === "products") context.identities = await loadByTuples(db, entity, ["brand_normalized", "mpn_normalized"], records.map(r => [lower(r.brand), lower(r.manufacturer_part_number)]));
  if (entity === "attributes") context.identities = await loadByTuples(db, entity, ["product_key", "name_normalized", "unit_normalized"], records.map(r => [String(r.product_key), lower(r.name), lower(r.unit)]));
  if (entity === "offers") context.identities = await loadByTuples(db, entity, ["supplier_key", "supplier_part_number"], records.map(r => [String(r.supplier_key), String(r.supplier_part_number)]));
  if (entity === "prices") for (const batch of chunks(unique(records.map(r => r.internal_sku)))) context.prices.push(...(await rows(db, `SELECT * FROM inv_prices WHERE internal_sku IN (${batch.map(() => "?").join(",")})`, batch)).map(r => fromStorage("prices", r)));
  if (entity === "opening_stock") {
    for (const batch of chunks(unique(records.map(r => r.internal_sku)))) for (const r of await rows(db, `SELECT internal_sku,location_key,disposition FROM inv_stock_events WHERE internal_sku IN (${batch.map(() => "?").join(",")}) GROUP BY internal_sku,location_key,disposition`, batch)) context.openingPositions.add(positionKey(r.internal_sku, r.location_key, r.disposition));
    for (const batch of chunks(unique(records.map(r => "opening:" + r.count_key)))) for (const r of await rows(db, `SELECT idempotency_key FROM inv_stock_events WHERE idempotency_key IN (${batch.map(() => "?").join(",")})`, batch)) context.openingKeys.add(String(r.idempotency_key));
  }
  return context;
}
function periodsOverlap(a: CleanRecord, b: CleanRecord): boolean { return String(a.valid_from || "0000-01-01") <= String(b.valid_to || "9999-12-31") && String(b.valid_from || "0000-01-01") <= String(a.valid_to || "9999-12-31"); }
function businessErrors(entity: EntityName, record: CleanRecord, context: ValidationContext, isUpdate = false): string[] {
  const errors: string[] = []; const def = ENTITY_DEFS[entity]; const key = String(record[def.idField]);
  if (!isUpdate && context.existing.has(key)) errors.push(`${def.singular} key ${key} already exists. Imports create new records only.`);
  for (const field of def.fields.filter(f => f.reference)) {
    const value = record[field.key]; if (!value) continue;
    if (!context.references.get(field.reference!)?.has(String(value))) errors.push(`${field.label}: ${value} does not exist. Create it before this record.`);
  }
  if (entity === "products" && context.identities.some(r => String(r.product_key) !== key && identity(r.brand, r.manufacturer_part_number) === identity(record.brand, record.manufacturer_part_number))) errors.push("This brand and manufacturer part number already identify another product.");
  if (entity === "attributes" && context.identities.some(r => String(r.attribute_key) !== key && String(r.product_key) === String(record.product_key) && identity(r.name, r.unit) === identity(record.name, record.unit))) errors.push("This product already has a specification with the same name and unit.");
  if (entity === "offers" && context.identities.some(r => String(r.offer_key) !== key && r.supplier_key === record.supplier_key && r.supplier_part_number === record.supplier_part_number)) errors.push("This supplier part number is already mapped to an offer.");
  if (entity === "prices" && record.status === "active" && context.prices.some(r => r.price_key !== record.price_key && r.status === "active" && r.price_list === record.price_list && r.internal_sku === record.internal_sku && r.minimum_quantity === record.minimum_quantity && periodsOverlap(r, record))) errors.push("An active price for this SKU, list, and quantity break already covers part of this date range. End or archive that price first.");
  if (entity === "fitments" && record.review_status === "verified") {
    const vehicle = context.references.get("vehicles")?.get(String(record.vehicle_key)); const product = context.references.get("products")?.get(String(record.product_key));
    if (vehicle && vehicle.configuration_status !== "reviewed") errors.push("A verified fitment requires a reviewed vehicle configuration; incomplete vehicle details remain unknown.");
    if (product && product.fitment_mode !== "vehicle_specific") errors.push("Set the product's suitability mode to vehicle_specific before verifying a vehicle application.");
  }
  if (entity === "opening_stock") {
    if (context.openingPositions.has(positionKey(record.internal_sku, record.location_key, record.disposition))) errors.push("This SKU/location/disposition already has stock history. Use a reasoned stock adjustment instead of another opening count.");
    if (context.openingKeys.has("opening:" + record.count_key)) errors.push("This opening count key has already been used.");
    for (const [ref, field] of [["skus", "internal_sku"], ["locations", "location_key"]] as const) { const linked = context.references.get(ref)?.get(String(record[field])); if (linked && linked.status !== "active") errors.push(`The referenced ${ref === "skus" ? "SKU" : "location"} must be active.`); }
  }
  return errors;
}
export async function validateBatchRecords(db: SqlDatabase, entity: EntityName, inputs: unknown[], mode: "import" | "create" = "import"): Promise<CheckedRow[]> {
  const checked = inputs.map((input, i) => ({ row: i + 2, ...normalizeRecord(entity, input, mode) }));
  const context = await validationContext(db, entity, checked.map(r => r.record)); const def = ENTITY_DEFS[entity]; const seen = new Set<string>(); const seenIdentities = new Set<string>(); const seenPositions = new Set<string>();
  for (const row of checked) {
    row.errors.push(...businessErrors(entity, row.record, context)); const key = String(row.record[def.idField] || "");
    if (seen.has(key)) row.errors.push(`Duplicate ${def.idField} in this import: ${key}.`); seen.add(key);
    let id: string | null = null;
    if (entity === "products") id = identity(row.record.brand, row.record.manufacturer_part_number);
    if (entity === "attributes") id = identity(row.record.product_key, row.record.name, row.record.unit);
    if (entity === "offers") id = identity(row.record.supplier_key, row.record.supplier_part_number);
    if (id) { if (seenIdentities.has(id)) row.errors.push("Another row in this batch has the same unique business identity."); seenIdentities.add(id); }
    if (entity === "prices") context.prices.push(row.record);
    if (entity === "opening_stock") { const position = positionKey(row.record.internal_sku, row.record.location_key, row.record.disposition); if (seenPositions.has(position)) row.errors.push("Another row already counts this same SKU/location/disposition."); seenPositions.add(position); }
  }
  return checked;
}

function priceGuard(record: CleanRecord, keyToExclude: string | null): { sql: string; values: Bound[] } {
  if (record.status !== "active") return { sql: "1", values: [] };
  return { sql: `NOT EXISTS (SELECT 1 FROM inv_prices p WHERE p.status='active' AND p.price_list=? AND p.internal_sku=? AND p.minimum_quantity_milli=? AND COALESCE(p.valid_from,'0000-01-01')<=? AND COALESCE(p.valid_to,'9999-12-31')>=?${keyToExclude ? " AND p.price_key<>?" : ""})`, values: [String(record.price_list), String(record.internal_sku), parseScaled(record.minimum_quantity, 3), String(record.valid_to || "9999-12-31"), String(record.valid_from || "0000-01-01"), ...(keyToExclude ? [keyToExclude] : [])] };
}
export function buildInsert(db: SqlDatabase, entity: EntityName, record: CleanRecord, actor: string): SqlStatement {
  const timestamp = now();
  if (entity === "opening_stock") {
    const sku = String(record.internal_sku), location = String(record.location_key), disposition = String(record.disposition), idempotency = "opening:" + record.count_key;
    return bind(db, `INSERT INTO inv_stock_events (id,idempotency_key,internal_sku,location_key,event_type,opening_position_key,quantity_milli,disposition,reason,actor,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (NOT EXISTS (SELECT 1 FROM inv_stock_events WHERE internal_sku=? AND location_key=? AND disposition=?) AND EXISTS(SELECT 1 FROM inv_skus WHERE internal_sku=? AND status='active') AND EXISTS(SELECT 1 FROM inv_locations WHERE location_key=? AND status='active')) OR EXISTS(SELECT 1 FROM inv_stock_events WHERE idempotency_key=?) RETURNING *`, [uid(), idempotency, sku, location, "opening", positionKey(sku, location, disposition), parseScaled(record.quantity, 3), disposition, String(record.reason || "Opening physical count"), actor, timestamp, sku, location, disposition, sku, location, idempotency]);
  }
  const data = { ...toStorage(entity, record), revision: 1, created_at: timestamp, updated_at: timestamp }; const columns = Object.keys(data); const values = Object.values(data) as Bound[];
  let where = "1"; const guardValues: Bound[] = [];
  if (entity === "prices") { const guard = priceGuard(record, null); where = `(${guard.sql}) OR EXISTS(SELECT 1 FROM inv_prices WHERE price_key=?)`; guardValues.push(...guard.values, String(record.price_key)); }
  return bind(db, `INSERT INTO ${entityTable(entity)} (${columns.map(quoted).join(",")}) SELECT ${columns.map(() => "?").join(",")} WHERE ${where} RETURNING *`, [...values, ...guardValues]);
}

export async function productReadiness(db: SqlDatabase, record: CleanRecord): Promise<{ ready: boolean; issues: string[] }> {
  const issues: string[] = []; const key = String(record.product_key);
  if (!record.source_name || !record.source_reference) issues.push("Add a catalog source and source reference for the product.");
  if (!record.description) issues.push("Add a useful customer-facing description.");
  if (!record.fitment_mode || record.fitment_mode === "unknown") issues.push("Choose how product suitability is determined.");
  if (!await one(db, "SELECT 1 AS present FROM inv_skus WHERE product_key=? AND status='active' LIMIT 1", [key])) issues.push("Create at least one active selling SKU.");
  if (record.fitment_mode === "vehicle_specific" && !await one(db, "SELECT 1 AS present FROM inv_fitments f JOIN inv_vehicles v ON v.vehicle_key=f.vehicle_key WHERE f.product_key=? AND f.review_status='verified' AND f.restriction_status IN ('none','resolved') AND v.configuration_status='reviewed' LIMIT 1", [key])) issues.push("Add a source-verified fitment linked to a reviewed vehicle configuration.");
  if (record.fitment_mode === "specification_based" && !await one(db, "SELECT 1 AS present FROM inv_attributes WHERE product_key=? LIMIT 1", [key])) issues.push("Add the technical specifications or approvals needed to assess suitability.");
  return { ready: issues.length === 0, issues };
}
function publicationGuard(record: CleanRecord): { sql: string; values: Bound[] } {
  if (record.publication_status !== "published") return { sql: "1", values: [] };
  let sql = "EXISTS(SELECT 1 FROM inv_skus WHERE product_key=? AND status='active')"; const values: Bound[] = [String(record.product_key)];
  if (record.fitment_mode === "vehicle_specific") { sql += " AND EXISTS(SELECT 1 FROM inv_fitments f JOIN inv_vehicles v ON v.vehicle_key=f.vehicle_key WHERE f.product_key=? AND f.review_status='verified' AND f.restriction_status IN ('none','resolved') AND v.configuration_status='reviewed')"; values.push(String(record.product_key)); }
  if (record.fitment_mode === "specification_based") { sql += " AND EXISTS(SELECT 1 FROM inv_attributes WHERE product_key=?)"; values.push(String(record.product_key)); }
  return { sql, values };
}

function pagination(url: URL): { page: number; pageSize: number; offset: number } {
  const requestedPage = Number(url.searchParams.get("page") || 1), requestedSize = Number(url.searchParams.get("pageSize") || 25);
  const page = Number.isInteger(requestedPage) ? Math.min(1_000_000, Math.max(1, requestedPage)) : 1;
  const pageSize = Number.isInteger(requestedSize) ? Math.min(100, Math.max(1, requestedSize)) : 25;
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export async function listRecords(request: Request): Promise<Row> {
  const db = getDatabase(), url = new URL(request.url), entity = entityName(url.searchParams.get("entity")), def = ENTITY_DEFS[entity], paging = pagination(url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 150); const values: Bound[] = [];
  const searchFields = def.displayFields.map(key => def.fields.find(f => f.key === key)!).filter(Boolean);
  const where = q ? "WHERE " + searchFields.map(field => `CAST(${qi(storageColumn(field))} AS TEXT) LIKE ? ESCAPE '\\'`).join(" OR ") : "";
  if (q) values.push(...searchFields.map(() => "%" + escapeLike(q) + "%"));
  const [count, result] = await Promise.all([one(db, `SELECT COUNT(*) AS total FROM ${entityTable(entity)} ${where}`, values), rows(db, `SELECT * FROM ${entityTable(entity)} ${where} ORDER BY updated_at DESC,${qi(def.idField)} LIMIT ? OFFSET ?`, [...values, paging.pageSize, paging.offset])]);
  return { records: result.map(r => fromStorage(entity, r)), total: Number(count?.total || 0), page: paging.page, pageSize: paging.pageSize };
}
export async function getRecord(request: Request): Promise<Row> {
  const db = getDatabase(), url = new URL(request.url), entity = entityName(url.searchParams.get("entity")); const key = (url.searchParams.get("key") || "").slice(0, 80);
  const raw = await one(db, `SELECT * FROM ${entityTable(entity)} WHERE ${qi(ENTITY_DEFS[entity].idField)}=?`, [key]);
  if (!raw) throw new InventoryError("This record was not found. Refresh the list.", 404, "record_not_found");
  const record = fromStorage(entity, raw); return { record, ...(entity === "products" ? { readiness: await productReadiness(db, record) } : {}) };
}
export async function createRecord(request: Request): Promise<Row> {
  const body = await readJson(request), entity = entityName(body.entity), db = getDatabase(); const checked = (await validateBatchRecords(db, entity, [body.record], "create"))[0];
  if (checked.errors.length) throw new InventoryError("Please correct the record before saving.", 422, "validation_error", { errors: checked.errors });
  const key = String(checked.record[ENTITY_DEFS[entity].idField]);
  const results = await db.batch([buildInsert(db, entity, checked.record, getActor(request)), auditStatement(db, "create", entity, key, `Created ${ENTITY_DEFS[entity].singular.toLowerCase()} ${key}.`, getActor(request), true)]);
  const raw = results[0].results?.[0] as Row | undefined;
  if (!raw) throw new InventoryError("Another change now conflicts with this record. Refresh and review the unique key or effective dates.", 409, "concurrent_conflict");
  return { record: fromStorage(entity, raw) };
}
export async function updateRecord(request: Request): Promise<Row> {
  const body = await readJson(request), entity = entityName(body.entity), def = ENTITY_DEFS[entity], db = getDatabase(), key = String(body.key || "");
  if (!Number.isInteger(body.revision) || Number(body.revision) < 1) throw new InventoryError("A valid current record revision is required.", 409, "revision_required");
  const raw = await one(db, `SELECT * FROM ${entityTable(entity)} WHERE ${qi(def.idField)}=?`, [key]);
  if (!raw) throw new InventoryError("The record no longer exists.", 404, "record_not_found");
  if (Number(raw.revision) !== Number(body.revision)) throw new InventoryError("This record changed since you opened it. Refresh before saving so another edit is not overwritten.", 409, "revision_conflict");
  if (!body.record || typeof body.record !== "object" || Array.isArray(body.record)) throw new InventoryError("Record fields are required.");
  const previous = fromStorage(entity, raw), input = body.record as Row;
  if (input[def.idField] !== undefined && input[def.idField] !== key) throw new InventoryError("The stable record key cannot be changed. Create a new record if the identity is different.");
  const normalized = normalizeRecord(entity, { ...previous, ...input, [def.idField]: key }, "update"); const context = await validationContext(db, entity, [normalized.record]);
  const errors = [...normalized.errors, ...businessErrors(entity, normalized.record, context, true)]; const guards: string[] = []; const guardValues: Bound[] = [];
  if (entity === "products" && ["base_unit_code", "brand", "manufacturer_part_number"].some(field => normalized.record[field] !== previous[field])) {
    if (await one(db, "SELECT 1 AS present FROM inv_skus WHERE product_key=? UNION ALL SELECT 1 FROM inv_fitments WHERE product_key=? LIMIT 1", [key, key])) errors.push("The part identity and canonical base unit cannot change while SKUs or fitments use them. Create a corrected replacement product and review its links instead.");
    guards.push("NOT EXISTS(SELECT 1 FROM inv_skus WHERE product_key=?) AND NOT EXISTS(SELECT 1 FROM inv_fitments WHERE product_key=?)"); guardValues.push(key, key);
  }
  if (entity === "vehicles" && ["year", "make", "model", "engine", "trim", "drivetrain", "transmission", "body", "market"].some(field => normalized.record[field] !== previous[field])) {
    if (await one(db, "SELECT 1 AS present FROM inv_fitments WHERE vehicle_key=? LIMIT 1", [key])) errors.push("Applications already reference this vehicle. Create a corrected replacement configuration and review/relink the affected fitments instead of silently changing what they fit.");
    guards.push("NOT EXISTS(SELECT 1 FROM inv_fitments WHERE vehicle_key=?)"); guardValues.push(key);
  }
  if (entity === "skus" && ["product_key", "selling_unit", "base_units_per_selling_unit"].some(field => normalized.record[field] !== previous[field])) {
    if (await one(db, "SELECT 1 AS present FROM inv_stock_events WHERE internal_sku=? LIMIT 1", [key])) errors.push("This SKU has stock history. Its product, selling unit, and package conversion cannot change because that would reinterpret past stock quantities.");
    guards.push("NOT EXISTS(SELECT 1 FROM inv_stock_events WHERE internal_sku=?)"); guardValues.push(key);
  }
  if (entity === "products" && normalized.record.publication_status === "published") { const readiness = await productReadiness(db, normalized.record); errors.push(...readiness.issues); const guard = publicationGuard(normalized.record); guards.push(guard.sql); guardValues.push(...guard.values); }
  if (entity === "prices") { const guard = priceGuard(normalized.record, key); guards.push(guard.sql); guardValues.push(...guard.values); }
  if (errors.length) throw new InventoryError("Please resolve these requirements before saving.", 422, "validation_error", { errors });
  const data: Record<string, Bound> = { ...toStorage(entity, normalized.record), revision: Number(body.revision) + 1, updated_at: now() }; delete data[def.idField];
  const columns = Object.keys(data), values = Object.values(data) as Bound[];
  const mutation = bind(db, `UPDATE ${entityTable(entity)} SET ${columns.map(c => qi(c) + "=?").join(",")} WHERE ${qi(def.idField)}=? AND revision=?${guards.length ? " AND (" + guards.join(") AND (") + ")" : ""} RETURNING *`, [...values, key, Number(body.revision), ...guardValues]);
  const results = await db.batch([mutation, auditStatement(db, "update", entity, key, `Updated ${def.singular.toLowerCase()} ${key}.`, getActor(request), true)]);
  const result = results[0].results?.[0] as Row | undefined;
  if (!result) throw new InventoryError("The record or one of its dependencies changed during this edit. Refresh and review the current revision and readiness.", 409, "revision_conflict");
  return { record: fromStorage(entity, result), ...(entity === "products" ? { readiness: await productReadiness(db, fromStorage(entity, result)) } : {}) };
}

const STOCK_CTE = `WITH balances AS (SELECT e.internal_sku,e.location_key,
 SUM(CASE WHEN e.disposition='sellable' THEN e.quantity_milli ELSE 0 END) AS sellable_milli,
 SUM(CASE WHEN e.disposition='damaged' THEN e.quantity_milli ELSE 0 END) AS damaged_milli,
 SUM(CASE WHEN e.disposition='quarantine' THEN e.quantity_milli ELSE 0 END) AS quarantine_milli,
 SUM(CASE WHEN e.disposition='core' THEN e.quantity_milli ELSE 0 END) AS core_milli
 FROM inv_stock_events e GROUP BY e.internal_sku,e.location_key), stock AS (
 SELECT b.*,s.selling_unit,s.reorder_point_milli,p.title AS product_title,l.name AS location_name
 FROM balances b JOIN inv_skus s ON s.internal_sku=b.internal_sku JOIN inv_products p ON p.product_key=s.product_key JOIN inv_locations l ON l.location_key=b.location_key)`;
function stockProjection(row: Row): Row { return { internal_sku: row.internal_sku, location_key: row.location_key, product_title: row.product_title, location_name: row.location_name, selling_unit: row.selling_unit, sellable: Number(row.sellable_milli) / 1000, damaged: Number(row.damaged_milli) / 1000, quarantine: Number(row.quarantine_milli) / 1000, core: Number(row.core_milli) / 1000, total: (Number(row.sellable_milli) + Number(row.damaged_milli) + Number(row.quarantine_milli) + Number(row.core_milli)) / 1000, available_quantity: Number(row.sellable_milli) / 1000, reorder_point: Number(row.reorder_point_milli) / 1000 }; }
export async function listStock(request: Request): Promise<Row> {
  const db = getDatabase(), url = new URL(request.url), paging = pagination(url), q = (url.searchParams.get("q") || "").trim().slice(0, 150);
  const selectedLocationKey = (url.searchParams.get("location_key") || "").trim() || null;
  const locations = await rows(db, "SELECT location_key,name,type,status,city,state FROM inv_locations ORDER BY name COLLATE NOCASE,location_key");
  if (selectedLocationKey && !locations.some(location => location.location_key === selectedLocationKey)) throw new InventoryError("Choose an existing stock location or clear the location filter.", 422, "invalid_location");
  const conditions: string[] = [], values: Bound[] = [];
  if (q) { conditions.push("(internal_sku LIKE ? ESCAPE '\\' OR product_title LIKE ? ESCAPE '\\' OR location_name LIKE ? ESCAPE '\\')"); values.push(...Array(3).fill("%" + escapeLike(q) + "%")); }
  if (selectedLocationKey) { conditions.push("location_key=?"); values.push(selectedLocationKey); }
  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
  const [result, counts] = await Promise.all([rows(db, STOCK_CTE + ` SELECT * FROM stock${where} ORDER BY internal_sku,location_key LIMIT ? OFFSET ?`, [...values, paging.pageSize, paging.offset]), one(db, STOCK_CTE + ` SELECT COUNT(*) AS positions,SUM(CASE WHEN sellable_milli>0 THEN 1 ELSE 0 END) AS in_stock,SUM(CASE WHEN sellable_milli<=reorder_point_milli THEN 1 ELSE 0 END) AS reorder FROM stock${where}`, values)]);
  return { records: result.map(stockProjection), total: Number(counts?.positions || 0), page: paging.page, pageSize: paging.pageSize, locations, selectedLocationKey, summary: { positions: Number(counts?.positions || 0), inStock: Number(counts?.in_stock || 0), atOrBelowReorder: Number(counts?.reorder || 0) } };
}
export async function adjustStock(request: Request): Promise<Row> {
  const body = await readJson(request), db = getDatabase(), sku = String(body.sku || "").trim(), location = String(body.location_key || "").trim(), disposition = String(body.disposition || "sellable"), reason = String(body.reason || "").trim(), idempotency = String(body.idempotency_key || "").trim();
  if (!sku || !location) throw new InventoryError("Choose a SKU and stock location.");
  if (!(STOCK_DISPOSITIONS as readonly string[]).includes(disposition)) throw new InventoryError("Choose a valid stock disposition.");
  if (reason.length < 3 || reason.length > 1000) throw new InventoryError("Enter a reason between 3 and 1,000 characters.");
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotency) || idempotency.startsWith("opening:")) throw new InventoryError("A fresh adjustment idempotency key is required.");
  const quantity = parseScaled(body.quantity, 3, "Quantity adjustment", true); if (quantity === 0) throw new InventoryError("An adjustment must add or remove a nonzero quantity.");
  const prior = await one(db, "SELECT * FROM inv_stock_events WHERE idempotency_key=?", [idempotency]);
  const same = (r: Row) => r.internal_sku === sku && r.location_key === location && r.disposition === disposition && Number(r.quantity_milli) === quantity && r.reason === reason;
  if (prior) { if (!same(prior)) throw new InventoryError("This operation key already belongs to a different adjustment.", 409, "idempotency_conflict"); return { event: { ...prior, quantity: quantity / 1000 }, duplicate: true }; }
  if (!await one(db, "SELECT 1 AS present FROM inv_skus WHERE internal_sku=? AND status='active'", [sku])) throw new InventoryError("Choose an existing active SKU.", 422);
  if (!await one(db, "SELECT 1 AS present FROM inv_locations WHERE location_key=? AND status='active'", [location])) throw new InventoryError("Choose an existing active stock location.", 422);
  // The quantity check and insert are ONE SQLite write statement, so concurrent
  // removals cannot both pass a stale read. No direct ledger-update API exists.
  const statement = bind(db, `INSERT INTO inv_stock_events (id,idempotency_key,internal_sku,location_key,event_type,opening_position_key,quantity_milli,disposition,reason,actor,created_at)
 SELECT ?,?,?,?,'adjustment',NULL,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM inv_stock_events WHERE idempotency_key=?)
 AND EXISTS(SELECT 1 FROM inv_skus WHERE internal_sku=? AND status='active') AND EXISTS(SELECT 1 FROM inv_locations WHERE location_key=? AND status='active')
 AND COALESCE((SELECT SUM(quantity_milli) FROM inv_stock_events WHERE internal_sku=? AND location_key=? AND disposition=?),0)+? BETWEEN 0 AND 1000000000000 RETURNING *`, [uid(), idempotency, sku, location, quantity, disposition, reason, getActor(request), now(), idempotency, sku, location, sku, location, disposition, quantity]);
  const results = await db.batch([statement, auditStatement(db, "stock_adjustment", "stock", sku, `${quantity > 0 ? "+" : ""}${quantity / 1000} selling units of ${sku} at ${location} (${disposition}): ${reason}`, getActor(request), true)]);
  const event = results[0].results?.[0] as Row | undefined;
  if (!event) { const concurrent = await one(db, "SELECT * FROM inv_stock_events WHERE idempotency_key=?", [idempotency]); if (concurrent && same(concurrent)) return { event: { ...concurrent, quantity: quantity / 1000 }, duplicate: true }; throw new InventoryError("This adjustment would take the disposition below zero, exceed the supported quantity, or use a location/SKU that changed. Refresh the balance and try again.", 409, "stock_conflict"); }
  const balance = await one(db, STOCK_CTE + " SELECT * FROM stock WHERE internal_sku=? AND location_key=?", [sku, location]);
  return { event: { ...event, quantity: quantity / 1000 }, balances: balance ? stockProjection(balance) : null, duplicate: false };
}

export async function bootstrap(): Promise<Row> {
  const db = getDatabase(); const counts: Record<string, number> = {};
  const countResults = await db.batch(ENTITY_LIST.map(def => db.prepare(def.importOnly ? "SELECT COUNT(*) AS total FROM inv_stock_events WHERE event_type='opening'" : `SELECT COUNT(*) AS total FROM ${entityTable(def.key)}`)));
  ENTITY_LIST.forEach((def, i) => counts[def.key] = Number((countResults[i].results?.[0] as Row)?.total || 0));
  const [ready, recentImports, recentActivity] = await Promise.all([
    one(db, `SELECT (SELECT COUNT(*) FROM inv_products WHERE publication_status='published') AS publishedProducts,
    (SELECT COUNT(DISTINCT internal_sku) FROM (SELECT internal_sku,SUM(quantity_milli) AS qty FROM inv_stock_events WHERE disposition='sellable' GROUP BY internal_sku HAVING qty>0)) AS stockedSkus,
    (SELECT COUNT(*) FROM inv_vehicles WHERE configuration_status='reviewed') AS reviewedVehicles,
    (SELECT COUNT(*) FROM inv_fitments WHERE review_status='verified') AS verifiedFitments`),
    rows(db, "SELECT id,entity,filename,status,valid_count,error_count,total_count,summary_json,created_at,applied_at FROM inv_import_batches ORDER BY created_at DESC LIMIT 5"), rows(db, "SELECT * FROM inv_audit_log ORDER BY created_at DESC LIMIT 8")
  ]);
  const readyCounts = Object.fromEntries(Object.entries(ready || {}).map(([key, value]) => [key, Number(value)]));
  const setup = [
    { key: "products", label: "Add your real products", description: "Start with the branded parts and their canonical units.", count: counts.products, entity: "products" },
    { key: "skus", label: "Define selling units", description: "Connect each sellable package to its product.", count: counts.skus, entity: "skus" },
    { key: "locations", label: "Set up a stock location", description: "Create the store, stockroom, or bin you will count.", count: counts.locations, entity: "locations" },
    { key: "stock", label: "Record physical stock", description: "Import opening counts or record an audited adjustment.", count: readyCounts.stockedSkus || 0, entity: "opening_stock" },
    { key: "fitments", label: "Review vehicle applications", description: "Use a trusted source for part-to-vehicle compatibility.", count: readyCounts.verifiedFitments || 0, entity: "fitments" },
    { key: "published", label: "Publish reviewed products", description: "Only explicitly published products reach the storefront.", count: readyCounts.publishedProducts || 0, entity: "products" },
  ].map(step => ({ ...step, complete: step.count > 0 }));
  return { counts, readyCounts, recentImports: recentImports.map(importSummary), recentActivity, setup, permissions: { mode: "staff_session", canWrite: true, staffAuthenticationEnabled: true, message: "Inventory access requires a verified staff or admin account." } };
}

function businessDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find(p => p.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
const REVIEWED_FITMENT = `f.review_status='verified' AND f.restriction_status IN ('none','resolved') AND v.configuration_status='reviewed'
 AND trim(COALESCE(v.engine,''))<>'' AND trim(COALESCE(v.drivetrain,''))<>'' AND trim(COALESCE(v.transmission,''))<>''
 AND trim(COALESCE(v.body,''))<>'' AND trim(COALESCE(v.source_name,''))<>'' AND trim(COALESCE(v.source_reference,''))<>''`;
const CONFIRMED_FITMENT = `${REVIEWED_FITMENT} AND f.restriction_status='none' AND trim(COALESCE(f.restrictions,''))=''`;

// Only these fields may leave the staff workspace. Warehouses, bins, archived
// stores, and internal notes are deliberately absent from the public projection.
function loadPublicLocations(db: SqlDatabase): Promise<Row[]> {
  return rows(db, "SELECT location_key,name,city,state,address_line1,address_line2,postal_code,phone,store_hours FROM inv_locations WHERE type='store' AND status='active' ORDER BY name COLLATE NOCASE,location_key");
}
export async function publicLocations(): Promise<Row> {
  return { locations: await loadPublicLocations(getDatabase()) };
}

// Public projection is intentionally explicit: no supplier costs, account
// contacts, internal notes, private price lists, or import payloads escape here.
export async function publicCatalog(request: Request): Promise<Row> {
  const db = getDatabase(), url = new URL(request.url), paging = pagination(url), today = businessDate();
  const q = (url.searchParams.get("q") || "").trim().slice(0, 150), category = (url.searchParams.get("category") || "").trim(), vehicleKey = (url.searchParams.get("vehicle_key") || "").trim();
  const selectedLocationKey = (url.searchParams.get("location_key") || "").trim() || null;
  const locations = await loadPublicLocations(db);
  if (selectedLocationKey && !locations.some(location => location.location_key === selectedLocationKey)) throw new InventoryError("Choose an active store or clear the store selection.", 422, "invalid_location");
  const skuKeys = unique((url.searchParams.get("skus") || url.searchParams.get("sku") || "").split(","));
  if (skuKeys.length > 100) throw new InventoryError("Look up no more than 100 SKUs at a time.");
  const conditions = ["p.publication_status='published'", "s.status='active'"]; const filterValues: Bound[] = [];
  if (q) { conditions.push("(p.title LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR p.manufacturer_part_number LIKE ? ESCAPE '\\' OR s.internal_sku LIKE ? ESCAPE '\\')"); filterValues.push(...Array(4).fill("%" + escapeLike(q) + "%")); }
  if (category && category !== "all") { conditions.push("p.category=?"); filterValues.push(category); }
  if (skuKeys.length) { conditions.push("s.internal_sku IN (SELECT value FROM json_each(?))"); filterValues.push(JSON.stringify(skuKeys)); }
  if (vehicleKey) { conditions.push(`(p.fitment_mode='non_vehicle_specific' OR EXISTS(SELECT 1 FROM inv_fitments f JOIN inv_vehicles v ON v.vehicle_key=f.vehicle_key WHERE f.product_key=p.product_key AND f.vehicle_key=? AND ${REVIEWED_FITMENT}))`); filterValues.push(vehicleKey); }
  const base = `FROM inv_skus s JOIN inv_products p ON p.product_key=s.product_key WHERE ${conditions.join(" AND ")}`;
  const priceSubquery = (column: string) => `(SELECT pr.${column} FROM inv_prices pr WHERE pr.internal_sku=s.internal_sku AND pr.price_list='retail' AND pr.status='active' AND pr.minimum_quantity_milli<=1000 AND (pr.valid_from IS NULL OR pr.valid_from<=?) AND (pr.valid_to IS NULL OR pr.valid_to>=?) ORDER BY pr.minimum_quantity_milli DESC,COALESCE(pr.valid_from,'0000-01-01') DESC,pr.price_key LIMIT 1)`;
  const sort = url.searchParams.get("sort") || "recommended";
  const order = sort === "price-asc" ? "price_cents IS NULL,price_cents ASC,title,internal_sku" : sort === "price-desc" ? "price_cents IS NULL,price_cents DESC,title,internal_sku" : sort === "name" ? "title COLLATE NOCASE,internal_sku" : "updated_at DESC,internal_sku";
  const select = `SELECT s.internal_sku,s.selling_unit,p.product_key,p.title,p.brand,p.manufacturer_part_number,p.category,p.description,p.image_url,p.fitment_mode,p.updated_at,
    ${priceSubquery("unit_price_cents")} AS price_cents,${priceSubquery("core_charge_cents")} AS core_cents ${base}`;
  const [count, found, categories] = await Promise.all([
    one(db, "SELECT COUNT(*) AS total " + base, filterValues),
    rows(db, `SELECT * FROM (${select}) ORDER BY ${order} LIMIT ? OFFSET ?`, [today, today, today, today, ...filterValues, paging.pageSize, paging.offset]),
    rows(db, "SELECT DISTINCT p.category FROM inv_products p WHERE p.publication_status='published' AND EXISTS(SELECT 1 FROM inv_skus s WHERE s.product_key=p.product_key AND s.status='active') ORDER BY p.category"),
  ]);
  // A sellable ledger row with a zero sum is recorded zero. No sellable ledger
  // row is unknown, even if damaged/quarantined/core stock exists at that store.
  // Fetch only this page's SKUs; selecting a store never filters out products.
  const stockRows = found.length ? await rows(db, `SELECT e.internal_sku,e.location_key,SUM(e.quantity_milli) AS available_milli
    FROM inv_stock_events e JOIN inv_locations l ON l.location_key=e.location_key
    WHERE e.disposition='sellable' AND l.type='store' AND l.status='active' AND e.internal_sku IN (SELECT value FROM json_each(?))
    GROUP BY e.internal_sku,e.location_key`, [JSON.stringify(found.map(product => product.internal_sku))]) : [];
  const stockBySku = new Map<string, Map<string, number>>();
  for (const stock of stockRows) {
    const sku = String(stock.internal_sku), byLocation = stockBySku.get(sku) || new Map<string, number>();
    byLocation.set(String(stock.location_key), Number(stock.available_milli)); stockBySku.set(sku, byLocation);
  }
  const productKeys = unique(found.map(r => r.product_key)), productAttributes: Row[] = [], productFitments: Row[] = [];
  for (const batch of chunks(productKeys)) {
    const marks = batch.map(() => "?").join(",");
    productAttributes.push(...await rows(db, `SELECT product_key,name,value,unit FROM inv_attributes WHERE product_key IN (${marks}) ORDER BY name`, batch));
    productFitments.push(...await rows(db, `SELECT f.product_key,f.vehicle_key,f.position,f.restrictions,f.restriction_status FROM inv_fitments f JOIN inv_vehicles v ON v.vehicle_key=f.vehicle_key WHERE f.product_key IN (${marks}) AND ${REVIEWED_FITMENT}`, batch));
  }
  const vehicles = await rows(db, `SELECT DISTINCT v.vehicle_key,v.year,v.make,v.model,v.engine,v.trim,v.drivetrain,v.transmission,v.body,v.market,v.configuration_status
    FROM inv_vehicles v JOIN inv_fitments f ON f.vehicle_key=v.vehicle_key JOIN inv_products p ON p.product_key=f.product_key
    WHERE p.publication_status='published' AND EXISTS(SELECT 1 FROM inv_skus s WHERE s.product_key=p.product_key AND s.status='active') AND ${CONFIRMED_FITMENT}
    ORDER BY v.year DESC,v.make,v.model,v.vehicle_key LIMIT 251`);
  const total = Number(count?.total || 0);
  return {
    products: found.map(r => {
      const byLocation = stockBySku.get(String(r.internal_sku));
      const recorded = locations.flatMap(location => { const quantity = byLocation?.get(String(location.location_key)); return quantity === undefined ? [] : [quantity]; });
      const selectedQuantity = selectedLocationKey ? byLocation?.get(selectedLocationKey) : undefined;
      const availableMilli = selectedLocationKey ? selectedQuantity ?? null : recorded.length ? recorded.reduce((sum, quantity) => sum + quantity, 0) : null;
      return { id: r.internal_sku, sku: r.internal_sku, product_key: r.product_key, name: r.title, brand: r.brand, manufacturer_part_number: r.manufacturer_part_number, category: r.category, description: r.description || "", image_url: r.image_url || null, price: r.price_cents === null ? null : Number(r.price_cents) / 100, core_charge: r.core_cents === null ? null : Number(r.core_cents) / 100, available_quantity: availableMilli === null ? null : availableMilli / 1000, selling_unit: r.selling_unit, fitment_mode: r.fitment_mode,
      availability_by_location: locations.map(location => { const quantity = byLocation?.get(String(location.location_key)); return { location_key: location.location_key, name: location.name, available_quantity: quantity === undefined ? null : quantity / 1000 }; }),
      attributes: productAttributes.filter(a => a.product_key === r.product_key).map(a => ({ name: a.name, value: a.value, unit: a.unit })),
      fitments: productFitments.filter(f => f.product_key === r.product_key).map(f => ({ vehicle_key: f.vehicle_key, position: f.position || "", restrictions: f.restrictions || "", review_status: f.restrictions ? "manual_confirmation" : "verified", verification_state: f.restrictions ? "manual_confirmation" : "source_verified" })),
    }; }), vehicles: vehicles.slice(0, 250), vehicleOptionsTruncated: vehicles.length > 250,
    locations, selectedLocationKey,
    categories: categories.map(r => String(r.category)), total, page: paging.page, pageSize: paging.pageSize, hasMore: paging.offset + found.length < total,
    catalogState: total ? "available" : "empty", stockNote: "Quantities reflect recorded sellable stock at active stores. Without a selected store, the quantity is the recorded total across those stores; unknown store counts remain unknown. Checkout reservations are not implemented in this inventory foundation."
  };
}

// Cascading facets come from actual eligible rows. They never manufacture a
// Cartesian product of makes/models/engines, and never expose private sources.
export async function publicVehicles(request: Request): Promise<Row> {
  const db = getDatabase(), url = new URL(request.url), field = url.searchParams.get("field") || "years";
  if (!["years", "makes", "models", "configurations"].includes(field)) throw new InventoryError("Choose years, makes, models, or configurations.");
  const year = url.searchParams.get("year"), make = url.searchParams.get("make"), model = url.searchParams.get("model");
  const predicates = ["p.publication_status='published'", "EXISTS(SELECT 1 FROM inv_skus s WHERE s.product_key=p.product_key AND s.status='active')", CONFIRMED_FITMENT]; const values: Bound[] = [];
  if (field !== "years") { if (!year || !/^\d{4}$/.test(year) || Number(year) < 1886 || Number(year) > 2200) throw new InventoryError("Choose a valid model year first."); predicates.push("v.year=?"); values.push(Number(year)); }
  if (field === "models" || field === "configurations") { if (!make?.trim() || make.length > 1000) throw new InventoryError("Choose a vehicle make first."); predicates.push("v.make=?"); values.push(make); }
  if (field === "configurations") { if (!model?.trim() || model.length > 1000) throw new InventoryError("Choose a model first."); predicates.push("v.model=?"); values.push(model); }
  const base = `FROM inv_vehicles v JOIN inv_fitments f ON f.vehicle_key=v.vehicle_key JOIN inv_products p ON p.product_key=f.product_key WHERE ${predicates.join(" AND ")}`;
  if (field === "configurations") {
    const [found, count] = await Promise.all([rows(db, `SELECT DISTINCT v.vehicle_key,v.year,v.make,v.model,v.engine,v.trim,v.drivetrain,v.transmission,v.body,v.market,v.configuration_status ${base} ORDER BY v.engine,v.trim,v.drivetrain,v.vehicle_key LIMIT 1001`, values), one(db, `SELECT COUNT(DISTINCT v.vehicle_key) AS total ${base}`, values)]);
    return { vehicles: found.slice(0, 1000), total: Number(count?.total || 0), truncated: found.length > 1000 };
  }
  const column = field === "years" ? "year" : field === "makes" ? "make" : "model";
  const result = await rows(db, `SELECT DISTINCT v.${column} AS value ${base} ORDER BY v.${column} ${field === "years" ? "DESC" : "COLLATE NOCASE"} LIMIT 501`, values);
  return { values: result.slice(0, 500).map(row => String(row.value)), truncated: result.length > 500 };
}
