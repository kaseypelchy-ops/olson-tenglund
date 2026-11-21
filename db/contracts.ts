/** The small SQL interface used by inventory code; no hosting-specific types. */
export type SqlValue = string | number | null;
export interface SqlResult<T = Record<string, unknown>> {
  success: true;
  results: T[];
}
export interface SqlStatement {
  bind(...values: SqlValue[]): SqlStatement;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
}
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  batch<T = Record<string, unknown>>(statements: SqlStatement[]): Promise<SqlResult<T>[]>;
}
