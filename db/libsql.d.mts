import type { Client, Config } from '@libsql/client';
import type { SqlDatabase, SqlResult, SqlStatement } from './contracts';
export class DatabaseConfigurationError extends Error { status: number; code: string; constructor(message: string); }
export function databaseConfig(environment?: Record<string, string | undefined>): Config;
export function createConfiguredClient(environment?: Record<string, string | undefined>): Client;
export class LibsqlDatabase implements SqlDatabase {
  readonly client: Client;
  constructor(client: Client);
  prepare(sql: string): SqlStatement;
  batch<T = Record<string, unknown>>(statements: SqlStatement[]): Promise<SqlResult<T>[]>;
}
