/** Test-only entry bundled by scripts/test-inventory.mjs. No HTTP listener. */
import { authorizeInventoryTestRequest } from "./inventory-auth-fixture";
export { getDatabase, getLibsqlClient } from "../db/connection";
import * as bootstrap from "../app/api/admin/bootstrap/route";
import * as records from "../app/api/admin/records/route";
import * as record from "../app/api/admin/record/route";
import * as stock from "../app/api/admin/stock/route";
import * as imports from "../app/api/admin/imports/route";
import * as preview from "../app/api/admin/imports/preview/route";
import * as apply from "../app/api/admin/imports/apply/route";
import * as catalog from "../app/api/catalog/route";
import * as vehicles from "../app/api/catalog/vehicles/route";
import * as locations from "../app/api/locations/route";

type Handler = (request: Request) => Promise<Response>;
const routes: Record<string, Record<string, Handler>> = {
  "/api/admin/bootstrap": { GET: bootstrap.GET },
  "/api/admin/records": { GET: records.GET, POST: records.POST, PUT: records.PUT },
  "/api/admin/record": { GET: record.GET },
  "/api/admin/stock": { GET: stock.GET, POST: stock.POST },
  "/api/admin/imports": { GET: imports.GET },
  "/api/admin/imports/preview": { POST: preview.POST },
  "/api/admin/imports/apply": { POST: apply.POST },
  "/api/catalog": { GET: catalog.GET },
  "/api/catalog/vehicles": { GET: vehicles.GET },
  "/api/locations": { GET: locations.GET },
};

async function dispatch(input: RequestInfo | URL, options: RequestInit | undefined, authenticated: boolean): Promise<Response> {
  const request = new Request(input, options);
  const url = new URL(request.url);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Test dispatch is restricted to loopback-shaped URLs; it never performs network requests.");
  if (authenticated) authorizeInventoryTestRequest(request);
  const route = routes[url.pathname];
  const handler = route?.[request.method];
  if (!handler) return Response.json({ error: { code: "test_route_not_found", message: `No actual handler for ${request.method} ${url.pathname}` } }, { status: route ? 405 : 404 });
  return handler(request);
}
export async function testFetch(input: RequestInfo | URL, options?: RequestInit): Promise<Response> { return dispatch(input, options, true); }
export async function testFetchAnonymous(input: RequestInfo | URL, options?: RequestInit): Promise<Response> { return dispatch(input, options, false); }
