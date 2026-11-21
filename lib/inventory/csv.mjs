/**
 * Small, strict CSV utilities shared by the inventory browser and server.
 * Parsing never rewrites a cell value. Semantic/entity validation belongs on
 * the server; an import preview is not permission to apply a record.
 */

const MAX_ROWS = 250;
const MAX_CHARACTERS = 2_000_000;

export class CsvError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CsvError';
    this.line = details.line;
    this.column = details.column;
    this.code = details.code || 'INVALID_CSV';
  }
}

function fail(message, line, column, code) {
  throw new CsvError(message, { line, column, code });
}

function validateHeaders(headers) {
  if (!headers.length) fail('The CSV needs a header row.', 1, 1, 'EMPTY_CSV');
  const seen = new Map();
  return headers.map((header, index) => {
    if (typeof header !== 'string') {
      fail(`Header ${index + 1} must be text.`, 1, index + 1, 'INVALID_HEADER');
    }
    const clean = header.trim();
    if (!clean) {
      fail(`Header ${index + 1} is blank. Give every column a unique name or remove the empty column.`, 1, index + 1, 'BLANK_HEADER');
    }
    const identity = clean.toLowerCase();
    if (seen.has(identity)) {
      fail(`Duplicate header “${clean}” in columns ${seen.get(identity)} and ${index + 1}. Rename one column before importing.`, 1, index + 1, 'DUPLICATE_HEADER');
    }
    seen.set(identity, index + 1);
    return clean;
  });
}

/**
 * Parse comma-separated UTF-8 text into a header array and string-valued rows.
 * Supports quoted commas, doubled quotes, multiline fields, BOM, CRLF and LF.
 * Empty physical lines are ignored; explicitly empty cells are retained.
 * Header whitespace is trimmed. All data-cell whitespace remains unchanged.
 */
export function parseCsv(input, { maxRows = MAX_ROWS } = {}) {
  if (typeof input !== 'string') throw new TypeError('CSV input must be text.');
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_ROWS) {
    throw new RangeError(`maxRows must be a whole number from 1 to ${MAX_ROWS}.`);
  }
  if (input.length > MAX_CHARACTERS) {
    fail('This CSV is too large for one preview. Split it into files with at most 250 data rows and fewer than 2 million characters.', 1, 1, 'FILE_TOO_LARGE');
  }

  const text = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
  let headers;
  const rows = [];
  let row = [];
  let field = '';
  let mode = 'plain';
  let recordStarted = false;
  let line = 1;
  let column = 1;
  let recordLine = 1;
  let quotedLine = 1;

  const finishField = () => {
    row.push(field);
    field = '';
    mode = 'plain';
  };

  const finishRecord = () => {
    // A trailing newline or a genuinely empty physical line is not a data row.
    if (!recordStarted && !row.length && !field) return;
    finishField();
    if (!headers) {
      headers = validateHeaders(row);
    } else {
      if (row.length !== headers.length) {
        fail(`Line ${recordLine} has ${row.length} columns; the header has ${headers.length}. Quote values that contain commas and check for missing or extra separators.`, recordLine, 1, 'COLUMN_COUNT');
      }
      if (rows.length >= maxRows) {
        fail(`This import supports at most ${maxRows} data rows per preview. Split the CSV into smaller files.`, recordLine, 1, 'ROW_LIMIT');
      }
      // A null prototype keeps literal headers such as __proto__ harmless.
      const item = Object.create(null);
      headers.forEach((header, index) => { item[header] = row[index]; });
      rows.push(item);
    }
    row = [];
    field = '';
    mode = 'plain';
    recordStarted = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (mode === 'quoted') {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
          column += 2;
        } else {
          mode = 'closed';
          column += 1;
        }
      } else if (character === '\r' || character === '\n') {
        if (character === '\r' && text[i + 1] === '\n') {
          field += '\r\n';
          i += 1;
        } else field += character;
        line += 1;
        column = 1;
      } else {
        field += character;
        column += 1;
      }
      continue;
    }

    if (character === ',') {
      recordStarted = true;
      finishField();
      column += 1;
      continue;
    }
    if (character === '\r' || character === '\n') {
      finishRecord();
      if (character === '\r' && text[i + 1] === '\n') i += 1;
      line += 1;
      recordLine = line;
      column = 1;
      continue;
    }
    if (mode === 'closed') {
      fail(`Unexpected character after a closing quote on line ${line}, column ${column}. A quoted value must be followed by a comma or a new line.`, line, column, 'AFTER_QUOTE');
    }
    if (character === '"') {
      if (field !== '') {
        fail(`Unexpected quote in an unquoted value on line ${line}, column ${column}. Enclose the entire value in quotes and double any quotation marks inside it.`, line, column, 'UNEXPECTED_QUOTE');
      }
      mode = 'quoted';
      quotedLine = line;
      recordStarted = true;
      column += 1;
      continue;
    }
    field += character;
    recordStarted = true;
    column += 1;
  }

  if (mode === 'quoted') {
    fail(`A quoted value beginning on line ${quotedLine} is not closed. Add its closing quotation mark.`, quotedLine, 1, 'UNCLOSED_QUOTE');
  }
  finishRecord();
  if (!headers) fail('The CSV is empty. Start with a header row or download a template.', 1, 1, 'EMPTY_CSV');
  return { headers, rows };
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('CSV exports cannot contain NaN or infinite numeric values.');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCell(value, protectFormulas) {
  let text = cellText(value);
  // Protect spreadsheet exports only. Do NOT modify identifiers during import.
  // Real finite numeric values (including negative stock movements) remain
  // numeric; untrusted strings beginning like formulas are escaped as text.
  if (protectFormulas && typeof value !== 'number' &&
      (/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text))) {
    text = "'" + text;
  }
  return /[",\r\n]/u.test(text) || /^\s|\s$/u.test(text)
    ? '"' + text.replace(/"/g, '""') + '"'
    : text;
}

/**
 * Serialize records (or arrays in header order) using CRLF line endings.
 * Export formula protection is on by default. It does not affect source rows.
 * Leading zeros are preserved in the CSV text; spreadsheet apps may apply
 * their own column typing when opening it, so import identifier columns as text.
 */
export function toCsv(headers, rows = [], { protectFormulas = true, includeBom = false } = {}) {
  if (!Array.isArray(headers) || !Array.isArray(rows)) {
    throw new TypeError('CSV headers and rows must be arrays.');
  }
  validateHeaders(headers);
  const lines = [headers.map((header) => escapeCell(header, protectFormulas)).join(',')];
  rows.forEach((row, index) => {
    if (row === null || typeof row !== 'object') throw new TypeError(`Export row ${index + 1} must be a record or an array.`);
    if (Array.isArray(row) && row.length !== headers.length) {
      throw new TypeError(`Export row ${index + 1} has ${row.length} columns; expected ${headers.length}.`);
    }
    const values = Array.isArray(row)
      ? row
      : headers.map((header) => Object.hasOwn(row, header) ? row[header] : '');
    lines.push(values.map((value) => escapeCell(value, protectFormulas)).join(','));
  });
  return (includeBom ? '\uFEFF' : '') + lines.join('\r\n') + '\r\n';
}

function fieldKey(field) {
  return typeof field === 'string' ? field : field?.key || field?.name || field?.id;
}

function normalizedHeader(value) {
  return String(value).normalize('NFKC').trim().toLowerCase().replace(/[\s_\-./()#]+/gu, '');
}

/**
 * Suggest only unambiguous matches. Keys are target field names and values are
 * exact source headers. Unknown/ambiguous columns remain for explicit mapping.
 */
export function suggestMapping(headers, fields) {
  const mapping = Object.create(null);
  const usedHeaders = new Set();
  const available = new Map();
  headers.forEach((header) => {
    const normalized = normalizedHeader(header);
    const matches = available.get(normalized) || [];
    matches.push(header);
    available.set(normalized, matches);
  });
  fields.forEach((field) => {
    const key = fieldKey(field);
    if (!key) return;
    const aliases = typeof field === 'object' && Array.isArray(field.aliases) ? field.aliases : [];
    const label = typeof field === 'object' ? field.label : undefined;
    const candidates = [key, label, ...aliases].filter(Boolean);
    for (const candidate of candidates) {
      const matches = available.get(normalizedHeader(candidate));
      if (matches?.length === 1 && !usedHeaders.has(matches[0])) {
        mapping[key] = matches[0];
        usedHeaders.add(matches[0]);
        break;
      }
    }
  });
  return mapping;
}

/** Header-only template: never inject example products into a real import. */
export function templateCsv(entityDef) {
  if (!entityDef || !Array.isArray(entityDef.fields)) {
    throw new TypeError('An entity definition with a fields array is required.');
  }
  const headers = entityDef.fields
    .filter((field) => typeof field === 'string' || (field.importable !== false && field.readOnly !== true))
    .map(fieldKey);
  return toCsv(headers, []);
}
