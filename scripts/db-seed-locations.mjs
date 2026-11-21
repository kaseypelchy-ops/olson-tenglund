#!/usr/bin/env node
/** Optional, explicit creation of the three confirmed stores. No inventory. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConfiguredClient } from '../db/libsql.mjs';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fields = ['location_key', 'name', 'type', 'status', 'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'phone', 'store_hours'];

export function validateLocationSeeds(input) {
  if (!Array.isArray(input) || input.length !== 3) throw new Error('The location seed must contain exactly the three confirmed stores.');
  const towns = new Set(['Coudersport', 'Port Allegany', 'Smethport']);
  const keys = new Set();
  return input.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(field => !fields.includes(field))) throw new Error('Location seed fields do not match the documented public store fields.');
    const clean = Object.fromEntries(fields.map(field => [field, typeof record[field] === 'string' ? record[field].trim() || null : record[field] ?? null]));
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(clean.location_key || '') || keys.has(clean.location_key)) throw new Error('Location seed keys must be unique, nonblank stable identifiers.');
    if (!clean.name || !towns.delete(clean.city) || clean.state !== 'PA' || clean.type !== 'store' || clean.status !== 'active') throw new Error('Seed only the confirmed active Coudersport, Port Allegany, and Smethport stores in Pennsylvania.');
    for (const [field, value] of Object.entries(clean)) if (value !== null && (typeof value !== 'string' || value.length > (field === 'store_hours' ? 10000 : 1000))) throw new Error(`Invalid location seed field: ${field}.`);
    keys.add(clean.location_key);
    return clean;
  });
}

export async function seedLocations(client, input) {
  const records = validateLocationSeeds(input);
  const timestamp = new Date().toISOString();
  const statements = records.flatMap(record => [
    {
      sql: `INSERT INTO inv_locations (${fields.join(',')},revision,created_at,updated_at) VALUES (${fields.map(() => '?').join(',')},1,?,?) ON CONFLICT(location_key) DO NOTHING RETURNING location_key`,
      args: [...fields.map(field => record[field]), timestamp, timestamp],
    },
    {
      sql: 'INSERT INTO inv_audit_log (id,action,entity,record_key,summary,actor,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()>0',
      args: [randomUUID(), 'seed_location', 'locations', record.location_key, `Created confirmed ${record.city} store from the explicit location seed.`, 'maintenance:seed-locations', timestamp],
    },
  ]);
  const results = await client.batch(statements, 'write');
  const created = records.filter((_, index) => results[index * 2].rows.length > 0).map(record => record.location_key);
  return { created, skipped: records.filter(record => !created.includes(record.location_key)).map(record => record.location_key), note: 'Existing location records were preserved. No products, prices, fitments, or stock were created.' };
}

async function main() {
  const input = JSON.parse(await readFile(resolve(projectDirectory, 'data/locations.json'), 'utf8'));
  validateLocationSeeds(input);
  const client = createConfiguredClient();
  try { console.log(JSON.stringify(await seedLocations(client, input))); }
  finally { client.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(`Location seed failed: ${error instanceof Error ? error.message : 'Unknown error'}`); process.exitCode = 1; });
}
