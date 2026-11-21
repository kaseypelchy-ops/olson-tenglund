import { createClient } from '@libsql/client';

/** Safe to display: never includes the configured URL, token, or driver error. */
export class DatabaseConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseConfigurationError';
    this.status = 503;
    this.code = 'database_not_configured';
  }
}

/** Shared by the Next.js runtime and explicitly invoked maintenance scripts. */
export function databaseConfig(environment = process.env) {
  const url = environment.TURSO_DATABASE_URL?.trim();
  const authToken = environment.TURSO_AUTH_TOKEN?.trim();
  const hosted = Boolean(environment.VERCEL) || environment.NODE_ENV === 'production';
  if (!url) throw new DatabaseConfigurationError('Inventory storage is not configured. Set TURSO_DATABASE_URL and, for a hosted database, TURSO_AUTH_TOKEN on the server.');
  let parsed;
  try { parsed = new URL(url); } catch { throw new DatabaseConfigurationError('TURSO_DATABASE_URL must be a valid libsql:// or https:// database URL; local development may use file:.'); }
  if (parsed.protocol === 'file:') {
    if (hosted) throw new DatabaseConfigurationError('Production requires a durable hosted libSQL database. file: and in-memory database URLs are not permitted on Vercel or in production.');
    if (parsed.host || parsed.search || parsed.hash) throw new DatabaseConfigurationError('Local development must use a plain file: database URL without a host, query, or fragment.');
    return { url, intMode: 'number' };
  }
  if (!['libsql:', 'https:', 'wss:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new DatabaseConfigurationError('Use a secure hosted libsql://, https://, or wss:// database URL without embedded credentials or query parameters.');
  }
  if (['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && hosted) throw new DatabaseConfigurationError('Production requires a durable remote database; loopback database URLs are not supported.');
  if (!authToken) throw new DatabaseConfigurationError('TURSO_AUTH_TOKEN is required for a hosted inventory database. Set it only in server-side environment variables.');
  return { url, authToken, intMode: 'number' };
}

export function createConfiguredClient(environment = process.env) {
  return createClient(databaseConfig(environment));
}

function resultProjection(result) {
  // libSQL rows also have numeric accessors. Copy only named SQL columns so
  // RETURNING and SELECT results retain the existing inventory API shape.
  const results = result.rows.map(row => Object.fromEntries(result.columns.map(column => [column, row[column]])));
  // Do not invent D1 metadata. In particular, local libSQL reports zero
  // rowsAffected for RETURNING statements. Inventory checks returned rows and
  // uses SQLite changes() inside the transaction for conditional audit writes.
  return { success: true, results };
}

class Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) {
    for (const value of values) {
      if (value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) throw new TypeError('SQL parameters must be finite numbers, strings, or null.');
    }
    return new Statement(this.database, this.sql, values);
  }
  async all() { return resultProjection(await this.database.client.execute({ sql: this.sql, args: this.values })); }
  async run() { return this.all(); }
  async first(column) {
    const row = (await this.all()).results[0];
    if (!row) return null;
    return column === undefined ? row : row[column] ?? null;
  }
}

/** Preserves inventory SQL while using libSQL's actual transactional batch. */
export class LibsqlDatabase {
  constructor(client) { this.client = client; }
  prepare(sql) {
    if (typeof sql !== 'string' || !sql.trim()) throw new TypeError('A nonblank SQL statement is required.');
    return new Statement(this, sql);
  }
  async batch(statements) {
    const batch = statements.map(statement => {
      if (!(statement instanceof Statement) || statement.database !== this) throw new TypeError('A batch must contain statements prepared by this database.');
      return { sql: statement.sql, args: statement.values };
    });
    if (!batch.length) return [];
    // Keep statements in one write transaction, in their original order.
    // Do not add SQL between them: audit guards depend on changes() from the
    // preceding mutation, and a failing import assertion must roll back all rows.
    return (await this.client.batch(batch, 'write')).map(resultProjection);
  }
}
