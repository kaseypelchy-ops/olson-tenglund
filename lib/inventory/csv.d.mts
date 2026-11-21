export type CsvRecord = Record<string, string>;
export interface CsvField {
  key?: string;
  name?: string;
  id?: string;
  label?: string;
  aliases?: readonly string[];
  importable?: boolean;
  readOnly?: boolean;
}
export class CsvError extends Error {
  line?: number;
  column?: number;
  code: string;
  constructor(message: string, details?: { line?: number; column?: number; code?: string });
}
export function parseCsv(text: string, options?: { maxRows?: number }): { headers: string[]; rows: CsvRecord[] };
export function toCsv(headers: readonly string[], rows?: readonly (Record<string, unknown> | readonly unknown[])[], options?: { protectFormulas?: boolean; includeBom?: boolean }): string;
export function suggestMapping(headers: readonly string[], fields: readonly (string | CsvField)[]): Record<string, string>;
export function templateCsv(entityDef: { fields: readonly (string | CsvField)[] }): string;
