#!/usr/bin/env node
/** Explicit schema maintenance. Never imported by the app or run during build. */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConfiguredClient } from '../db/libsql.mjs';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const historyTable = 'ot_schema_migrations';

export async function loadMigrations(project = projectDirectory) {
  const directory = resolve(project, 'drizzle');
  const journal = JSON.parse(await readFile(resolve(directory, 'meta/_journal.json'), 'utf8'));
  if (journal.dialect !== 'sqlite' || !Array.isArray(journal.entries) || !journal.entries.length) throw new Error('A nonempty SQLite Drizzle migration journal is required.');
  const files = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  const migrations = [];
  for (const [position, entry] of journal.entries.entries()) {
    if (entry.idx !== position || typeof entry.tag !== 'string' || !/^\d{4}_[a-zA-Z0-9_-]+$/.test(entry.tag)) throw new Error('Migration journal order or tags are invalid. Restore the checked-in journal before migrating.');
    const filename = entry.tag + '.sql';
    const source = await readFile(resolve(directory, filename), 'utf8');
    const statements = source.split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean);
    if (!statements.length) throw new Error(`Migration ${filename} has no SQL statements.`);
    // Generated CREATE/ALTER/INDEX migrations are safe in one transaction.
    // A future table rebuild that toggles foreign_keys needs a deliberate,
    // reviewed migration strategy; do not silently disable integrity checks.
    if (statements.some(sql => /^\s*(?:BEGIN|COMMIT|ROLLBACK|END\s+TRANSACTION)\b|\bPRAGMA\s+(?:foreign_keys|defer_foreign_keys)\s*=/i.test(sql))) throw new Error(`Migration ${filename} changes transaction or foreign-key settings. Review that migration before applying it with this runner.`);
    migrations.push({ id: entry.idx, tag: entry.tag, filename, checksum: createHash('sha256').update(source).digest('hex'), statements });
  }
  const expected = migrations.map(migration => migration.filename).sort();
  if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error('The Drizzle journal and SQL files disagree. Generate or restore the missing journal entries before migrating.');
  return migrations;
}

function verifyHistory(history, migrations) {
  if (history.length > migrations.length) throw new Error('The database contains migrations missing from this checkout. Use the complete migration history.');
  for (const [index, row] of history.entries()) {
    const migration = migrations[index];
    if (Number(row.id) !== migration.id || row.tag !== migration.tag || row.sha256 !== migration.checksum) throw new Error(`Applied migration history does not match ${migration.filename}. Applied SQL files must not be edited, removed, or reordered; create a new migration instead.`);
  }
}

export async function runMigrations(client, { project = projectDirectory, log = console.log } = {}) {
  const migrations = await loadMigrations(project);
  const foreignKeys = await client.execute('PRAGMA foreign_keys');
  if (Number(foreignKeys.rows[0]?.foreign_keys) !== 1) throw new Error('This database connection does not enforce foreign keys. Enable foreign-key enforcement before applying inventory migrations.');
  await client.execute(`CREATE TABLE IF NOT EXISTS ${historyTable} (
    id INTEGER PRIMARY KEY, tag TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const history = (await client.execute(`SELECT id,tag,sha256 FROM ${historyTable} ORDER BY id`)).rows;
  verifyHistory(history, migrations);
  let applied = 0, skipped = history.length;
  for (const migration of migrations.slice(history.length)) {
    try {
      // The history insert is a concurrency claim and commits with the schema.
      // A failed later statement rolls back both it and all earlier statements.
      await client.batch([
        { sql: `INSERT INTO ${historyTable} (id,tag,sha256,applied_at) VALUES (?,?,?,?)`, args: [migration.id, migration.tag, migration.checksum, new Date().toISOString()] },
        ...migration.statements,
      ], 'write');
      applied += 1;
      log(`Applied ${migration.filename}`);
    } catch (error) {
      // Another explicit runner may have won the same transaction. Only accept
      // a matching committed checksum; ordinary SQL failures remain failures.
      const current = (await client.execute({ sql: `SELECT id,tag,sha256 FROM ${historyTable} WHERE id=?`, args: [migration.id] })).rows[0];
      if (!current || current.tag !== migration.tag || current.sha256 !== migration.checksum) throw error;
      skipped += 1;
    }
  }
  return { applied, skipped, total: migrations.length };
}

async function main() {
  const client = createConfiguredClient();
  try { console.log(JSON.stringify(await runMigrations(client))); }
  finally { client.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`); process.exitCode = 1; });
}
