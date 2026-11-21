/** Exercises the shipped adapter/maintenance code against real local libSQL. */
import assert from 'node:assert/strict';
import { appendFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConfiguredClient, databaseConfig, DatabaseConfigurationError } from '../db/libsql.mjs';
import { loadMigrations, runMigrations } from '../scripts/db-migrate.mjs';
import { seedLocations } from '../scripts/db-seed-locations.mjs';

export async function runLibsqlChecks({ db, client, project, runDirectory }) {
  let passed = 0;
  const check = label => { passed += 1; console.log('PASS ' + label); };
  assert.throws(() => databaseConfig({}), error => error instanceof DatabaseConfigurationError && error.status === 503);
  assert.throws(() => databaseConfig({ TURSO_DATABASE_URL: 'file:local.db', VERCEL: '1' }), /durable hosted/);
  assert.throws(() => databaseConfig({ TURSO_DATABASE_URL: 'file::memory:', NODE_ENV: 'production' }), /durable hosted/);
  assert.throws(() => databaseConfig({ TURSO_DATABASE_URL: 'https://database.example' }), /TURSO_AUTH_TOKEN/);
  assert.throws(() => databaseConfig({ TURSO_DATABASE_URL: 'http://database.example', TURSO_AUTH_TOKEN: 'test-only-unused-token' }), /secure hosted/);
  assert.equal(databaseConfig({ TURSO_DATABASE_URL: 'file:local.db', NODE_ENV: 'test' }).url, 'file:local.db');
  check('server database configuration rejects missing secrets and ephemeral production storage');

  const migrations = await loadMigrations(project);
  const firstRun = await runMigrations(client, { project, log: () => {} });
  assert.equal(firstRun.applied, migrations.length);
  const secondRun = await runMigrations(client, { project, log: () => {} });
  assert.equal(secondRun.applied, 0); assert.equal(secondRun.skipped, migrations.length);
  const changedProject = resolve(runDirectory, 'changed-migration');
  await mkdir(changedProject, { recursive: true });
  await cp(resolve(project, 'drizzle'), resolve(changedProject, 'drizzle'), { recursive: true });
  await appendFile(resolve(changedProject, 'drizzle', migrations[0].filename), '\n-- TEST ONLY checksum drift\n');
  await assert.rejects(runMigrations(client, { project: changedProject, log: () => {} }), /Applied migration history does not match/);
  check('actual migration journal is idempotent and detects edits to previously applied SQL');

  const failedProject = resolve(runDirectory, 'failed-migration');
  await mkdir(resolve(failedProject, 'drizzle/meta'), { recursive: true });
  await writeFile(resolve(failedProject, 'drizzle/meta/_journal.json'), JSON.stringify({ dialect: 'sqlite', entries: [{ idx: 0, tag: '0000_failure_test' }] }));
  await writeFile(resolve(failedProject, 'drizzle/0000_failure_test.sql'), 'CREATE TABLE rollback_probe (value TEXT NOT NULL);\n--> statement-breakpoint\nINSERT INTO rollback_probe(value) VALUES(NULL);');
  const failedClient = createConfiguredClient({ TURSO_DATABASE_URL: pathToFileURL(resolve(runDirectory, 'failed-migration.db')).href, NODE_ENV: 'test' });
  try {
    await assert.rejects(runMigrations(failedClient, { project: failedProject, log: () => {} }), /NOT NULL/);
    assert.equal((await failedClient.execute("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='rollback_probe'")).rows[0].count, 0);
    assert.equal((await failedClient.execute('SELECT COUNT(*) AS count FROM ot_schema_migrations')).rows[0].count, 0);
  } finally { failedClient.close(); }
  check('a failed migration rolls back its schema changes and checksum history together');

  await db.batch([
    db.prepare('CREATE TABLE qa_adapter_probe (id TEXT PRIMARY KEY, value INTEGER NOT NULL CHECK(value>=0))'),
    db.prepare('CREATE TABLE qa_adapter_audit (id TEXT NOT NULL)'),
    db.prepare('CREATE TABLE qa_adapter_child (parent_id TEXT REFERENCES qa_adapter_probe(id))'),
  ]);
  const inserted = await db.batch([
    db.prepare('INSERT INTO qa_adapter_probe(id,value) VALUES(?,?) RETURNING id,value').bind('one', 7),
    db.prepare("INSERT INTO qa_adapter_audit(id) SELECT 'one' WHERE changes()>0"),
  ]);
  assert.deepEqual(inserted[0].results, [{ id: 'one', value: 7 }]);
  const skipped = await db.batch([
    db.prepare("UPDATE qa_adapter_probe SET value=9 WHERE id='missing' RETURNING id,value"),
    db.prepare("INSERT INTO qa_adapter_audit(id) SELECT 'must-not-exist' WHERE changes()>0"),
  ]);
  assert.equal(skipped[0].results.length, 0);
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM qa_adapter_audit').first('count'), 1);
  assert.equal(await db.prepare('SELECT value FROM qa_adapter_probe WHERE id=?').bind('one').first('value'), 7);
  assert.equal(await db.prepare("SELECT * FROM qa_adapter_probe WHERE id='missing'").first(), null);
  await assert.rejects(db.prepare("INSERT INTO qa_adapter_child(parent_id) VALUES('missing')").run(), /FOREIGN KEY/);
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO qa_adapter_probe(id,value) VALUES('rolled-back',1)"),
    db.prepare("INSERT INTO qa_adapter_probe(id,value) VALUES('invalid',NULL)"),
  ]), /NOT NULL/);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM qa_adapter_probe WHERE id IN ('rolled-back','invalid')").first('count'), 0);
  check('libSQL adapter preserves RETURNING, named rows, foreign keys, changes() audit guards, and full rollback');

  const seeds = JSON.parse(await readFile(resolve(project, 'data/locations.json'), 'utf8'));
  const seeded = await seedLocations(client, seeds);
  assert.equal(seeded.created.length, 3);
  const preservedKey = seeds[0].location_key;
  await client.execute({ sql: 'UPDATE inv_locations SET name=? WHERE location_key=?', args: ['TEST ONLY retained staff edit', preservedKey] });
  const seededAgain = await seedLocations(client, seeds);
  assert.equal(seededAgain.created.length, 0); assert.equal(seededAgain.skipped.length, 3);
  assert.equal((await client.execute({ sql: 'SELECT name FROM inv_locations WHERE location_key=?', args: [preservedKey] })).rows[0].name, 'TEST ONLY retained staff edit');
  assert.equal((await client.execute('SELECT COUNT(*) AS count FROM inv_products')).rows[0].count, 0);
  assert.equal((await client.execute('SELECT COUNT(*) AS count FROM inv_stock_events')).rows[0].count, 0);
  assert.equal((await client.execute("SELECT COUNT(*) AS count FROM inv_audit_log WHERE action='seed_location'")).rows[0].count, 3);
  check('three-store seed creates no inventory and preserves existing store edits on repeat');
  return { passed, migrations: migrations.length };
}
