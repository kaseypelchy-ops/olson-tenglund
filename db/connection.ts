import type { Client } from '@libsql/client';
import type { SqlDatabase } from './contracts';
import { createConfiguredClient, LibsqlDatabase } from './libsql.mjs';

let client: Client | undefined;
let database: SqlDatabase | undefined;

// Lazy initialization is intentional: importing routes during next build must
// neither open a database nor require production secrets. No automatic schema
// migration or seeding happens in this module or in a request handler.
export function getLibsqlClient(): Client {
  if (!client) client = createConfiguredClient();
  return client;
}
export function getDatabase(): SqlDatabase {
  if (!database) database = new LibsqlDatabase(getLibsqlClient());
  return database;
}
