import { ENTITY_DEFS, type EntityName, type FieldDefinition } from "./entities";

export class InventoryError extends Error {
  status: number; code: string; details?: unknown;
  constructor(message: string, status = 400, code = "validation_error", details?: unknown) { super(message); this.name = "InventoryError"; this.status = status; this.code = code; this.details = details; }
}
export type CleanRecord = Record<string, string | number | boolean | null>;
export interface ValidationResult { record: CleanRecord; errors: string[]; }
export const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
export const MAX_SCALED = 1_000_000_000_000;

// Parse from decimal text, not floating-point multiplication. Money uses scale
// 100; inventory uses scale 1000. Excess precision is rejected, never rounded.
export function parseScaled(value: unknown, decimals: number, label = "Value", allowNegative = false): number {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match || (!allowNegative && match[1] === "-")) throw new InventoryError(`${label} must be ${allowNegative ? "a signed" : "a nonnegative"} decimal number.`);
  const fraction = match[3] || "";
  if (fraction.length > decimals) throw new InventoryError(`${label} supports at most ${decimals} decimal places; no automatic rounding is performed.`);
  const whole = Number(match[2]); const scale = 10 ** decimals;
  const scaled = whole * scale + Number(fraction.padEnd(decimals, "0"));
  if (!Number.isSafeInteger(scaled) || scaled > MAX_SCALED) throw new InventoryError(`${label} is too large.`);
  return match[1] === "-" ? -scaled : scaled;
}
export function storageColumn(field: FieldDefinition): string { return field.key + (field.type === "money" ? "_cents" : field.type === "number" ? "_milli" : ""); }
export function toStorage(entity: EntityName, record: CleanRecord): Record<string, string | number | null> {
  const result: Record<string, string | number | null> = Object.create(null);
  for (const field of ENTITY_DEFS[entity].fields) {
    const value = record[field.key]; const key = storageColumn(field);
    result[key] = value === null || value === undefined ? null : field.type === "money" ? parseScaled(value, 2, field.label) : field.type === "number" ? parseScaled(value, 3, field.label) : field.type === "boolean" ? (value ? 1 : 0) : value as string | number;
  }
  if (entity === "products") { result.brand_normalized = String(record.brand).toLocaleLowerCase("en-US"); result.mpn_normalized = String(record.manufacturer_part_number).toLocaleLowerCase("en-US"); }
  if (entity === "attributes") { result.name_normalized = String(record.name).toLocaleLowerCase("en-US"); result.unit_normalized = String(record.unit || "").toLocaleLowerCase("en-US"); }
  return result;
}
export function fromStorage(entity: EntityName, row: Record<string, unknown>): CleanRecord {
  const record: CleanRecord = Object.create(null);
  for (const field of ENTITY_DEFS[entity].fields) {
    const value = row[storageColumn(field)];
    record[field.key] = value === null || value === undefined ? null : field.type === "money" ? Number(value) / 100 : field.type === "number" ? Number(value) / 1000 : field.type === "boolean" ? Boolean(value) : value as string | number;
  }
  record.revision = Number(row.revision); record.created_at = String(row.created_at); record.updated_at = String(row.updated_at);
  return record;
}
function isDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }

export function normalizeRecord(entity: EntityName, input: unknown, mode: "create" | "update" | "import" = "create"): ValidationResult {
  const def = ENTITY_DEFS[entity]; const record: CleanRecord = Object.create(null); const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { record, errors: ["A record must be an object with named fields."] };
  const raw = input as Record<string, unknown>;
  const allowed = new Set([...def.fields.map(f => f.key), "revision", "created_at", "updated_at"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) errors.push(`Unknown field: ${key}.`);
  for (const field of def.fields) {
    let value = Object.prototype.hasOwnProperty.call(raw, field.key) ? raw[field.key] : field.default ?? null;
    if (typeof value === "string") value = value.trim();
    if (value === "" || value === null || value === undefined) {
      if (field.default !== undefined) value = field.default;
      else { record[field.key] = null; if (field.required) errors.push(`${field.label} is required.`); continue; }
    }
    try {
      if (field.type === "money" || field.type === "number") {
        const decimals = field.type === "money" ? 2 : 3; const n = parseScaled(value, decimals, field.label) / 10 ** decimals;
        if (field.min !== undefined && n < field.min) throw new InventoryError(`${field.label} must be at least ${field.min}.`);
        if (field.max !== undefined && n > field.max) throw new InventoryError(`${field.label} must be at most ${field.max}.`);
        record[field.key] = n;
      } else if (field.type === "integer") {
        if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new InventoryError(`${field.label} must be a whole number.`);
        const n = Number(value);
        if (n < (field.min ?? 0) || n > (field.max ?? 1_000_000_000)) throw new InventoryError(`${field.label} is outside the allowed range.`);
        record[field.key] = n;
      } else if (field.type === "boolean") {
        const text = String(value).toLowerCase();
        if (!["true", "false", "1", "0", "yes", "no"].includes(text)) throw new InventoryError(`${field.label} must be true or false.`);
        record[field.key] = ["true", "1", "yes"].includes(text);
      } else {
        if (typeof value !== "string" && typeof value !== "number") throw new InventoryError(`${field.label} must be text.`);
        const text = String(value).trim(); const max = field.type === "textarea" ? 10_000 : field.type === "url" ? 2048 : 1000;
        if (text.length > max) throw new InventoryError(`${field.label} is too long (maximum ${max} characters).`);
        if (field.required && !text) throw new InventoryError(`${field.label} is required.`);
        if (field.options && !field.options.includes(text)) throw new InventoryError(`${field.label} must be one of: ${field.options.join(", ")}.`);
        if (field.type === "email" && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new InventoryError(`${field.label} must be a valid email address.`);
        if (field.type === "url" && text) { let url: URL; try { url = new URL(text); } catch { throw new InventoryError(`${field.label} must be a full http(s) URL.`); } if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new InventoryError(`${field.label} must be an http(s) URL without credentials.`); }
        if (field.type === "date" && !isDate(text)) throw new InventoryError(`${field.label} must be a valid YYYY-MM-DD date.`);
        if (field.type === "datetime") { if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)?$/.test(text) || !isDate(text.slice(0, 10)) || Number.isNaN(Date.parse(text))) throw new InventoryError(`${field.label} must be a valid date and time.`); record[field.key] = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(text) ? text : text + "Z").toISOString(); }
        else record[field.key] = text;
      }
    } catch (error) { errors.push(error instanceof Error ? error.message : `${field.label} is invalid.`); record[field.key] = null; }
  }
  const naturalKey = record[def.idField];
  if (naturalKey && !KEY_PATTERN.test(String(naturalKey))) errors.push(`${def.fields.find(f => f.key === def.idField)?.label || "Key"} must start with a letter or number and contain at most 80 letters, numbers, periods, underscores, or hyphens.`);
  if (entity === "products" && mode !== "update") record.publication_status = "draft";
  if (entity === "fitments" && mode === "import") record.review_status = "draft";
  if (entity === "vehicles" && mode === "import") record.configuration_status = "partial";
  if (entity === "offers" && record.reported_available !== null && !record.availability_observed_at) errors.push("Availability checked at is required when supplier availability is entered.");
  if (entity === "prices" && record.valid_from && record.valid_to && String(record.valid_to) < String(record.valid_from)) errors.push("Effective through must be on or after Effective from.");
  if (entity === "fitments") {
    if (record.restriction_status === "none" && record.restrictions) errors.push("Restriction review cannot be 'none' while restrictions are entered. Keep them unresolved or review them explicitly.");
    if (record.review_status === "verified" && record.restriction_status === "unresolved") errors.push("Resolve or explicitly confirm there are no restrictions before marking an application verified.");
  }
  if (entity === "vehicles" && record.configuration_status === "reviewed") {
    for (const field of ["engine", "drivetrain", "transmission", "body", "source_name", "source_reference"]) if (!record[field]) errors.push(`A reviewed configuration requires ${def.fields.find(f => f.key === field)?.label || field}.`);
  }
  return { record, errors };
}

export const quoteIdentifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';
