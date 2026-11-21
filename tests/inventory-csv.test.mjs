import assert from 'node:assert/strict';
import test from 'node:test';
import { CsvError, parseCsv, toCsv, suggestMapping, templateCsv } from '../lib/inventory/csv.mjs';

const plainRows = (result) => result.rows.map((row) => ({ ...row }));

test('imports BOM and CRLF while preserving leading-zero identifiers and cell whitespace', () => {
  const result = parseCsv('\uFEFF sku , quantity\r\n00127,02\r\n 0042 ,3\r\n');
  assert.deepEqual(result.headers, ['sku', 'quantity']);
  assert.deepEqual(plainRows(result), [{ sku: '00127', quantity: '02' }, { sku: ' 0042 ', quantity: '3' }]);
});

test('handles quoted commas, escaped quotes, multiline fields and quoted trailing empty fields', () => {
  const result = parseCsv('id,description,note\r\nA,"Filter, oil","Says ""premium""\r\nsecond line"\r\nB,Plain,""');
  assert.equal(result.rows[0].description, 'Filter, oil');
  assert.equal(result.rows[0].note, 'Says "premium"\r\nsecond line');
  assert.deepEqual({ ...result.rows[1] }, { id: 'B', description: 'Plain', note: '' });
});

test('ignores blank physical rows but keeps explicitly empty data cells', () => {
  const result = parseCsv('\nid,qty\n\n001,1\n,\n\n');
  assert.equal(result.rows.length, 2);
  assert.deepEqual({ ...result.rows[1] }, { id: '', qty: '' });
});

test('rejects blank or duplicate headers including case/outer-whitespace variants', () => {
  for (const text of ['sku,,quantity\na,b,c', 'sku,SKU\na,b', ' sku ,sku\na,b']) {
    assert.throws(() => parseCsv(text), (error) => error instanceof CsvError && /header/i.test(error.message));
  }
  assert.throws(() => parseCsv('""\nx'), { code: 'BLANK_HEADER' });
  assert.throws(() => parseCsv(''), { code: 'EMPTY_CSV' });
});

test('rejects malformed quoting and records with incorrect field counts', () => {
  assert.throws(() => parseCsv('sku,note\na,"not closed'), { code: 'UNCLOSED_QUOTE' });
  assert.throws(() => parseCsv('sku,note\na,b"c'), { code: 'UNEXPECTED_QUOTE' });
  assert.throws(() => parseCsv('sku,note\na,"b"c'), { code: 'AFTER_QUOTE' });
  assert.throws(() => parseCsv('sku,qty\na,1,2'), { code: 'COLUMN_COUNT', line: 2 });
  assert.throws(() => parseCsv('sku,qty\na'), { code: 'COLUMN_COUNT', line: 2 });
});

test('enforces 250 data rows without counting the header or blank lines', () => {
  const lines = Array.from({ length: 250 }, (_, i) => `00${i},1`);
  assert.equal(parseCsv('sku,qty\n' + lines.join('\n') + '\n\n').rows.length, 250);
  assert.throws(() => parseCsv('sku,qty\n' + lines.join('\n') + '\nextra,1'), { code: 'ROW_LIMIT' });
  assert.throws(() => parseCsv('sku\na\nb', { maxRows: 1 }), { code: 'ROW_LIMIT' });
  assert.throws(() => parseCsv('sku\na', { maxRows: 251 }), RangeError);
});

test('does not interpret prototype-shaped headers or change formula-shaped import values', () => {
  const result = parseCsv('__proto__,constructor,sku\nvalue,ordinary,=NOT_EXECUTED');
  assert.equal(result.rows[0].__proto__, 'value');
  assert.equal(result.rows[0].constructor, 'ordinary');
  assert.equal(result.rows[0].sku, '=NOT_EXECUTED');
  assert.equal(Object.getPrototypeOf(result.rows[0]), null);
  assert.equal({}.value, undefined);
});

test('exports spreadsheet formula strings safely without changing the source objects', () => {
  const data = [
    { sku: '00127', note: '=HYPERLINK("bad")', qty: -2 },
    { sku: 'SAMPLE-001', note: '\t+SUM(1,1)', qty: 3 },
    { sku: 'OT-FIL-01', note: 'ordinary', qty: 4 },
    { sku: 'X', note: '  @SUM(1,1)', qty: 5 }
  ];
  const before = structuredClone(data);
  const parsed = parseCsv(toCsv(['sku', 'note', 'qty'], data));
  assert.equal(parsed.rows[0].sku, '00127');
  assert.equal(parsed.rows[0].note, '\'=HYPERLINK("bad")');
  assert.equal(parsed.rows[0].qty, '-2');
  assert.equal(parsed.rows[1].sku, 'SAMPLE-001');
  assert.equal(parsed.rows[1].note, "'\t+SUM(1,1)");
  assert.equal(parsed.rows[2].note, 'ordinary');
  assert.equal(parsed.rows[3].note, "'  @SUM(1,1)");
  assert.deepEqual(data, before);
});

test('serializes round-trippable data, quotes whitespace, supports BOM and optional raw export', () => {
  const rows = [{ sku: '0008', description: 'A, B\nC "quoted"', note: ' spaced ' }];
  const text = toCsv(['sku', 'description', 'note'], rows, { includeBom: true });
  assert.equal(text.charCodeAt(0), 0xFEFF);
  assert.deepEqual(plainRows(parseCsv(text)), rows);
  assert.equal(parseCsv(toCsv(['note'], [{ note: '=raw' }], { protectFormulas: false })).rows[0].note, '=raw');
  assert.throws(() => toCsv(['qty'], [{ qty: NaN }]), TypeError);
});

test('suggests only unambiguous mappings and leaves unknown fields unmapped', () => {
  const mapping = suggestMapping(['SKU', 'Product Name', 'brand code', 'Unknown'], [
    { key: 'internal_sku', label: 'Internal SKU', aliases: ['SKU'] },
    { key: 'name', label: 'Product Name' },
    { key: 'brand_code' },
    { key: 'unit' }
  ]);
  assert.deepEqual({ ...mapping }, { internal_sku: 'SKU', name: 'Product Name', brand_code: 'brand code' });
  assert.deepEqual({ ...suggestMapping(['part_number', 'Part Number'], [{ key: 'part_number' }]) }, {});
});

test('templates contain headers only and omit nonimportable fields', () => {
  const csv = templateCsv({ fields: [{ key: 'id', readOnly: true }, { key: 'sku' }, { key: 'quantity' }, { key: 'internal', importable: false }] });
  assert.deepEqual(parseCsv(csv), { headers: ['sku', 'quantity'], rows: [] });
  assert.equal(csv, 'sku,quantity\r\n');
});
