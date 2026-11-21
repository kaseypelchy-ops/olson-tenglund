#!/usr/bin/env node
/** Actual inventory routes + shipped libSQL adapter, disposable files, no network. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createConfiguredClient } from '../db/libsql.mjs';
import { runInventoryIntegration } from '../tests/inventory-integration.mjs';
import { runLibsqlChecks } from '../tests/libsql-checks.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(project, 'outputs/tests');
await mkdir(outputDirectory, { recursive: true });
const runDirectory = await mkdtemp(resolve(outputDirectory, 'inventory-'));
const bundle = resolve(runDirectory, 'inventory-routes.mjs');
const savedEnvironment = Object.fromEntries(['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'NODE_ENV', 'VERCEL'].map(key => [key, process.env[key]]));
for (const key of Object.keys(savedEnvironment)) delete process.env[key];
process.env.NODE_ENV = 'test';
const originalFetch = globalThis.fetch;
let blockedNetworkRequests = 0;
globalThis.fetch = async () => { blockedNetworkRequests += 1; throw new Error('Network fetch is disabled in the inventory integration runner.'); };
let client, competitor;
try {
  await build({
    absWorkingDir: project,
    entryPoints: [resolve(project, 'tests/inventory-routes.ts')],
    outfile: bundle,
    bundle: true,
    packages: 'external',
    platform: 'node',
    target: 'node24',
    format: 'esm',
    tsconfig: resolve(project, 'tsconfig.json'),
    logLevel: 'warning',
    plugins: [{
      name: 'inventory-test-only-auth-dependency',
      setup(builder) {
        // This dependency substitution exists only in this test build. The app
        // imports real Better Auth; there is no runtime bypass flag or header.
        builder.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: resolve(project, 'tests/inventory-auth-fixture.ts') }));
      },
    }],
  });
  const routes = await import(pathToFileURL(bundle).href);
  const { testFetch, testFetchAnonymous } = routes;
  const origin = 'http://127.0.0.1:4173';
  const missingConfig = await testFetchAnonymous(origin + '/api/catalog');
  assert.equal(missingConfig.status, 503);
  assert.equal((await missingConfig.json()).error.code, 'database_not_configured');
  const anonymous = await testFetchAnonymous(origin + '/api/admin/bootstrap', { headers: { 'oai-authenticated-user-id': 'forged-owner', 'x-user-role': 'admin' } });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, 'auth_required');
  let additionalPassed = 1;
  console.log('PASS lazy route loading needs no database and protected handlers do not trust identity headers');

  const databaseUrl = pathToFileURL(resolve(runDirectory, 'inventory.db')).href;
  process.env.TURSO_DATABASE_URL = databaseUrl;
  const db = routes.getDatabase();
  client = routes.getLibsqlClient();
  competitor = createConfiguredClient({ TURSO_DATABASE_URL: databaseUrl, NODE_ENV: 'test' });
  const persistence = await runLibsqlChecks({ db, client, project, runDirectory });
  for (const path of ['/api/catalog', '/api/catalog/vehicles', '/api/locations']) assert.equal((await testFetchAnonymous(origin + path)).status, 200, path);
  additionalPassed += 1;
  console.log('PASS public catalog, vehicle facets, and store directory remain accessible without staff authorization');

  // One-shot hooks are test instrumentation on this adapter instance. They let
  // an independent real client commit just after application validation and
  // before the tested adapter starts its actual write transaction.
  let nextBatchHook = null, batchCount = 0, rejectedBatches = 0;
  const productionBatch = db.batch.bind(db);
  db.batch = async statements => {
    const hook = nextBatchHook; nextBatchHook = null;
    if (hook) await hook(competitor);
    batchCount += 1;
    try { return await productionBatch(statements); }
    catch (error) { rejectedBatches += 1; throw error; }
  };
  function beforeNextBatch(hook) { assert.equal(nextBatchHook, null); nextBatchHook = hook; }
  const base = await runInventoryIntegration({ testFetch, origin, environment: 'real-libsql-file-adapter' });
  async function request(path, body, method = body ? 'POST' : 'GET') {
    const response = await testFetch(origin + path, { method, headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, ok: response.ok, data: await response.json() };
  }
  async function good(path, body, method) { const result = await request(path, body, method); assert.ok(result.ok, JSON.stringify(result)); return result.data; }
  async function preview(entity, records) {
    const headers = [...new Set(records.flatMap(Object.keys))];
    const rows = records.map(row => Object.fromEntries(headers.map(header => [header, String(row[header] ?? '')])));
    const result = await good('/api/admin/imports/preview', { entity, filename: 'TEST-ONLY-atomic-rollback.csv', rows, mapping: Object.fromEntries(headers.map(header => [header, header])) });
    assert.equal(result.errorCount, 0); return result;
  }

  const sku = base.prefix + '-S', priceList = base.prefix + '-RACE';
  const priceOne = base.prefix + '-ATOMICPRICE1', priceTwo = base.prefix + '-ATOMICPRICE2';
  const stagePrice = await preview('prices', [
    { price_key: priceOne, internal_sku: sku, price_list: priceList, minimum_quantity: 1, unit_price: '10.00', core_charge: 0 },
    { price_key: priceTwo, internal_sku: sku, price_list: priceList, minimum_quantity: 2, unit_price: '9.00', core_charge: 0 },
  ]);
  beforeNextBatch(async otherClient => {
    const stamp = new Date().toISOString();
    await otherClient.execute({ sql: 'INSERT INTO inv_prices (price_key,price_list,internal_sku,minimum_quantity_milli,unit_price_cents,core_charge_cents,status,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)', args: [base.prefix + '-RACECONFLICT', priceList, sku, 2000, 800, 0, 'active', stamp, stamp] });
  });
  const priceResult = await request('/api/admin/imports/apply', { id: stagePrice.id });
  assert.equal(priceResult.status, 409, JSON.stringify(priceResult));
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM inv_prices WHERE price_key IN (?,?)').bind(priceOne, priceTwo).first('count'), 0, 'No earlier row in a conflicted price batch may survive.');
  assert.equal(await db.prepare('SELECT status FROM inv_import_batches WHERE id=?').bind(stagePrice.id).first('status'), 'preview');
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM inv_audit_log WHERE record_key=? AND action=?').bind(stagePrice.id, 'import_apply').first('count'), 0);
  additionalPassed += 1;
  console.log('PASS real libSQL rollback of a price import after a competing committed conflict');

  const location = base.prefix + '-ATOMICLOCATION';
  await good('/api/admin/records', { entity: 'locations', record: { location_key: location, name: 'TEST ONLY atomic opening bin', type: 'bin' } });
  const stageStock = await preview('opening_stock', [
    { count_key: base.prefix + '-ATOMICOPEN1', internal_sku: sku, location_key: location, disposition: 'sellable', quantity: 7, reason: 'TEST ONLY opening' },
    { count_key: base.prefix + '-ATOMICOPEN2', internal_sku: sku, location_key: location, disposition: 'quarantine', quantity: 2, reason: 'TEST ONLY opening' },
  ]);
  beforeNextBatch(async otherClient => {
    await otherClient.execute({ sql: 'INSERT INTO inv_stock_events (id,idempotency_key,internal_sku,location_key,event_type,opening_position_key,quantity_milli,disposition,reason,actor,created_at) VALUES (?,?,?,?,?,NULL,?,?,?,?,?)', args: [crypto.randomUUID(), base.prefix + '-RACESTOCK', sku, location, 'adjustment', 1000, 'quarantine', 'TEST ONLY competing committed adjustment', 'test-adapter', new Date().toISOString()] });
  });
  const stockResult = await request('/api/admin/imports/apply', { id: stageStock.id });
  assert.equal(stockResult.status, 409, JSON.stringify(stockResult));
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM inv_stock_events WHERE location_key=? AND event_type='opening'").bind(location).first('count'), 0, 'No earlier opening count may survive a conflicted batch.');
  assert.equal(await db.prepare('SELECT SUM(quantity_milli) AS balance FROM inv_stock_events WHERE location_key=?').bind(location).first('balance'), 1000, 'Only the independently committed adjustment remains.');
  assert.equal(await db.prepare('SELECT status FROM inv_import_batches WHERE id=?').bind(stageStock.id).first('status'), 'preview');
  additionalPassed += 1;
  console.log('PASS real libSQL rollback of an opening-stock import after position history appears concurrently');
  assert.equal(nextBatchHook, null);
  assert.ok(rejectedBatches >= 2);
  const auditActor = await db.prepare("SELECT actor FROM inv_audit_log WHERE action='create' AND entity='products' ORDER BY created_at LIMIT 1").first('actor');
  assert.equal(auditActor, 'staff:inventory-integration-fixture');
  client.close(); competitor.close();
  const reopened = createConfiguredClient({ TURSO_DATABASE_URL: databaseUrl, NODE_ENV: 'test' });
  try { assert.ok(Number((await reopened.execute('SELECT COUNT(*) AS count FROM inv_products')).rows[0].count) > 0); }
  finally { reopened.close(); }
  additionalPassed += 1;
  console.log('PASS committed inventory survives closing all clients and reopening the database file');
  assert.equal(blockedNetworkRequests, 0, 'No handler or persistence check may attempt network access.');
  console.log(JSON.stringify({ passed: base.passed + additionalPassed + persistence.passed, inventoryGroups: base.passed, persistenceGroups: persistence.passed, additionalGroups: additionalPassed, transactionalBatches: batchCount, rejectedBatches, migrations: persistence.migrations, environment: 'actual-api-handlers-and-shipped-libsql-adapter-local-file', authenticationDependency: 'test-only-request-fixture; actual sessions tested separately', hostedTursoTested: false, browserTested: false, networkRequests: 0 }));
} finally {
  client?.close(); competitor?.close();
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(runDirectory, { recursive: true, force: true });
}
