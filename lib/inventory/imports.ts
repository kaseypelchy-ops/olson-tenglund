import type { SqlDatabase, SqlStatement } from "@/db/contracts";
import { ENTITY_DEFS, isEntityName, type EntityName } from "./entities";
import { InventoryError, quoteIdentifier, type CleanRecord } from "./validation";
import {
  auditStatement,
  buildInsert,
  entityTable,
  getActor,
  getDatabase,
  importSummary,
  readJson,
  validateBatchRecords,
} from "./server";

type CheckedRow = { row: number; record: CleanRecord; errors: string[] };
type StageRow = Record<string, unknown> & {
  id: string;
  entity: string;
  filename: string;
  status: string;
  rows_json: string;
  error_count: number;
  total_count: number;
};

function importEntity(value: unknown): EntityName {
  if (!isEntityName(value) || !ENTITY_DEFS[value].importable) {
    throw new InventoryError("Choose a supported inventory record type before importing.", 400, "invalid_import_entity");
  }
  return value;
}

/** Validate the envelope again on the server; the CSV wizard is not trusted. */
function mapImportRows(entity: EntityName, rowsInput: unknown, mappingInput: unknown) {
  if (!Array.isArray(rowsInput) || rowsInput.length < 1 || rowsInput.length > 250) {
    throw new InventoryError("An import preview must contain between 1 and 250 data rows. Split larger files into separate batches.", 400, "import_row_limit");
  }
  if (!mappingInput || typeof mappingInput !== "object" || Array.isArray(mappingInput)) {
    throw new InventoryError("Provide a field-to-column mapping before validating this CSV.", 400, "invalid_import_mapping");
  }
  const mapping = mappingInput as Record<string, unknown>;
  const validFields = new Set(ENTITY_DEFS[entity].fields.filter((field) => !field.readOnly).map((field) => field.key));
  const pairs: Array<[string, string]> = [];
  const mappedSources = new Set<string>();
  for (const [target, source] of Object.entries(mapping)) {
    if (!validFields.has(target)) throw new InventoryError(`“${target}” is not an importable field for ${ENTITY_DEFS[entity].label.toLowerCase()}.`, 400, "invalid_import_mapping");
    if (typeof source !== "string" || !source.trim()) throw new InventoryError(`Choose a nonblank source column for “${target}”, or leave the field unmapped.`, 400, "invalid_import_mapping");
    if (mappedSources.has(source)) throw new InventoryError(`Source column “${source}” is mapped more than once. Use a separate column for each target field.`, 400, "invalid_import_mapping");
    mappedSources.add(source);
    pairs.push([target, source]);
  }
  if (!pairs.length) throw new InventoryError("Map at least one source column before validating this CSV.", 400, "invalid_import_mapping");

  let headers: string[] | undefined;
  const mapped = rowsInput.map((input, index) => {
    const rowNumber = index + 2;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new InventoryError(`CSV row ${rowNumber} must contain named text columns.`, 400, "invalid_import_row");
    const sourceRow = input as Record<string, unknown>;
    const keys = Object.keys(sourceRow);
    if (!headers) {
      headers = keys;
      if (!headers.length || headers.some((key) => !key.trim())) throw new InventoryError("Every CSV column needs a nonblank header.", 400, "invalid_import_header");
      const normalized = headers.map((header) => header.trim().toLowerCase());
      if (new Set(normalized).size !== normalized.length) throw new InventoryError("CSV headers must be unique, including capitalization and surrounding-space variants.", 400, "duplicate_import_header");
      for (const [, source] of pairs) if (!Object.hasOwn(sourceRow, source)) throw new InventoryError(`Mapped column “${source}” does not exist in this CSV. Check the field mapping.`, 400, "missing_import_column");
    } else if (keys.length !== headers.length || headers.some((header) => !Object.hasOwn(sourceRow, header))) {
      throw new InventoryError(`CSV row ${rowNumber} does not have the same columns as the header. Recheck the source file.`, 400, "invalid_import_row");
    }
    for (const key of keys) if (typeof sourceRow[key] !== "string") throw new InventoryError(`CSV row ${rowNumber}, column “${key}” must be text. Keep identifiers as text to preserve leading zeros.`, 400, "invalid_import_value");
    const record: Record<string, string> = Object.create(null);
    for (const [target, source] of pairs) record[target] = sourceRow[source] as string;
    return record;
  });
  return { mapped, mapping: Object.fromEntries(pairs) };
}

function normalizeRowNumbers(rows: Array<{ row: number; record: CleanRecord; errors: string[] }>): CheckedRow[] {
  // CSV error downloads use these indexes to recover the original source row.
  return rows.map((row, index) => ({ ...row, row: index + 2 }));
}

export async function handleImportPreview(request: Request) {
  const body = await readJson(request);
  const entity = importEntity(body.entity);
  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  if (!filename || filename.length > 200) throw new InventoryError("Provide a filename or pasted-list label of 1–200 characters.", 400, "invalid_import_filename");
  const { mapped, mapping } = mapImportRows(entity, body.rows, body.mapping);
  const db = await getDatabase();
  const checked = normalizeRowNumbers(await validateBatchRecords(db, entity, mapped, "import"));
  const errorCount = checked.filter((row) => row.errors.length > 0).length;
  const validCount = checked.length - errorCount;
  const id = "imp_" + crypto.randomUUID();
  const actor = getActor(request);
  const now = new Date().toISOString();
  const summary = {
    operation: "create_only",
    entity: ENTITY_DEFS[entity].label,
    totalCount: checked.length,
    validCount,
    errorCount,
    readiness: errorCount ? "Fix the rejected rows and create a new preview before applying." : "Ready for a final check against current records before applying.",
    safeguards: entity === "opening_stock"
      ? "Opening stock creates audited ledger events only where that SKU, location and disposition have no previous stock history. It never overwrites existing stock."
      : "Existing records are never overwritten. Imported products remain drafts, vehicles remain partial, and fitment applications remain drafts.",
  };
  await db.prepare(`INSERT INTO inv_import_batches
    (id, entity, filename, status, mapping_json, rows_json, summary_json, actor, created_at, valid_count, error_count, total_count)
    VALUES (?, ?, ?, 'preview', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, entity, filename, JSON.stringify(mapping), JSON.stringify(checked), JSON.stringify(summary), actor, now, validCount, errorCount, checked.length)
    .run();
  return { id, entity, filename, status: "preview", validCount, errorCount, totalCount: checked.length, rows: checked, summary, created_at: now };
}

async function readStage(db: SqlDatabase, id: string): Promise<StageRow | null> {
  return db.prepare("SELECT * FROM inv_import_batches WHERE id = ?").bind(id).first<StageRow>();
}

function appliedResult(stage: StageRow, duplicate: boolean) {
  return { ...importSummary(stage), importedCount: Number(stage.total_count), appliedCount: Number(stage.total_count), duplicate };
}

export async function handleImportApply(request: Request) {
  const body = await readJson(request);
  if (typeof body.id !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(body.id)) throw new InventoryError("Choose a saved import preview to apply.", 400, "invalid_import_id");
  const db = await getDatabase();
  const stage = await readStage(db, body.id);
  if (!stage) throw new InventoryError("That saved import preview was not found. Validate your source file again.", 404, "import_not_found");
  if (stage.status === "applied") return appliedResult(stage, true);
  if (stage.status !== "preview") throw new InventoryError("This batch is not an applicable import preview.", 409, "import_not_ready");
  if (Number(stage.error_count) > 0) throw new InventoryError("This preview has rejected rows. Fix them and create a new preview; no records have been imported.", 409, "import_has_errors");
  const entity = importEntity(stage.entity);
  let savedRows: CheckedRow[];
  try {
    const parsed: unknown = JSON.parse(stage.rows_json);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 250 || parsed.length !== Number(stage.total_count)) throw new Error("Invalid row count");
    if (parsed.some((row) => !row || typeof row !== "object" || !row.record || typeof row.record !== "object" || Array.isArray(row.record) || !Array.isArray(row.errors) || row.errors.length)) throw new Error("Invalid checked rows");
    savedRows = parsed as CheckedRow[];
  } catch {
    throw new InventoryError("This saved preview is incomplete or invalid. Validate the source file again before applying.", 409, "invalid_saved_import");
  }

  // Only the immutable server-side records are applied. Any rows/mapping in
  // this request are deliberately ignored, and every reference is rechecked.
  const checked = normalizeRowNumbers(await validateBatchRecords(db, entity, savedRows.map((row) => row.record), "import"));
  const conflicts = checked.filter((row) => row.errors.length);
  if (conflicts.length) {
    const current = await readStage(db, stage.id);
    if (current?.status === "applied") return appliedResult(current, true);
    throw new InventoryError("The inventory changed after this preview was saved. Nothing was imported. Review these conflicts and create a new preview.", 409, "import_conflict", { rows: conflicts });
  }

  const def = ENTITY_DEFS[entity];
  const actor = getActor(request);
  const keys = checked.map((row) => String(row.record[def.idField]));
  const targetTable = entity === "opening_stock" ? "inv_stock_events" : entityTable(entity);
  const targetKey = entity === "opening_stock" ? "idempotency_key" : def.idField;
  const storedKeys = entity === "opening_stock" ? keys.map((key) => "opening:" + key) : keys;
  const now = new Date().toISOString();
  const statements: SqlStatement[] = checked.map((row) => buildInsert(db, entity, row.record, actor));
  // Conditional inserts can return zero rows if a price/stock conflict appears
  // concurrently. This NOT NULL assertion aborts the whole transactional batch unless all
  // intended rows exist and this exact stage is still unapplied. Ordinary
  // inserts must also throw on existing natural keys; they never ignore them.
  statements.push(db.prepare(`UPDATE inv_import_batches SET
    status = CASE WHEN status = 'preview' AND
      (SELECT COUNT(*) FROM ${targetTable} WHERE ${quoteIdentifier(targetKey)} IN (SELECT value FROM json_each(?))) = ?
      THEN 'applied' ELSE NULL END,
    applied_at = ?
    WHERE id = ? RETURNING *`)
    .bind(JSON.stringify(storedKeys), checked.length, now, stage.id));
  statements.push(auditStatement(db, "import_apply", entity, stage.id, `Imported ${checked.length} ${def.label.toLowerCase()} records from ${stage.filename}.`, actor, true));

  try {
    await db.batch(statements);
  } catch {
    // Two requests may try the same saved stage. Its first committed result is
    // authoritative; an unrelated conflict must leave the whole batch undone.
    const current = await readStage(db, stage.id);
    if (current?.status === "applied") return appliedResult(current, true);
    throw new InventoryError("This import could not be applied because a record, price rule, or stock position changed. The entire batch was rolled back. Create a new preview to see the current conflicts.", 409, "import_apply_conflict");
  }
  const applied = await readStage(db, stage.id);
  if (!applied || applied.status !== "applied") throw new InventoryError("The import result could not be confirmed. Check import history before retrying.", 409, "import_result_unconfirmed");
  return appliedResult(applied, false);
}

export async function listImportHistory() {
  const db = await getDatabase();
  // History never needs potentially large staged row payloads.
  const result = await db.prepare("SELECT id, entity, filename, status, valid_count, error_count, total_count, created_at, applied_at, summary_json FROM inv_import_batches ORDER BY created_at DESC, id DESC LIMIT 50").all<Record<string, unknown>>();
  return { imports: result.results.map(importSummary) };
}
