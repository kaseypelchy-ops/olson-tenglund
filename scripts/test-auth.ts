import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createAuthOptions, readAuthEnvironment } from "../lib/auth-config";
import { InventoryError } from "../lib/inventory/validation";

// These tests use the real Better Auth handlers, signed cookies, authorization
// wrapper and libSQL driver. All writes are confined to a disposable local DB.
const directory = await mkdtemp(join(tmpdir(), "olson-auth-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  TURSO_DATABASE_URL: `file:${join(directory, "auth-test.db")}`,
  BETTER_AUTH_URL: "http://localhost:3000",
});
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;
delete process.env.BETTER_AUTH_SECRET;

const { getLibsqlClient } = await import("../db/connection");
const client = getLibsqlClient();
const { GET: authGet, POST: authPost } = await import("../app/api/auth/[...all]/route");
const { requireAdminActor } = await import("../lib/auth");
const routes = {
  bootstrap: await import("../app/api/admin/bootstrap/route"),
  records: await import("../app/api/admin/records/route"),
  record: await import("../app/api/admin/record/route"),
  stock: await import("../app/api/admin/stock/route"),
  imports: await import("../app/api/admin/imports/route"),
  preview: await import("../app/api/admin/imports/preview/route"),
  apply: await import("../app/api/admin/imports/apply/route"),
};
const origin = "http://localhost:3000";
const password = randomBytes(24).toString("base64url");
let groups = 0;

function request(path: string, method = "GET", body?: unknown, cookie?: string, extraHeaders?: Record<string, string>) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      origin,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function signIn(email: string) {
  const response = await authPost(request("/api/auth/sign-in/email", "POST", { email, password, rememberMe: false }));
  assert.equal(response.status, 200, "Valid credentials should sign in");
  const cookies = response.headers.getSetCookie();
  assert(cookies.some((cookie) => cookie.includes("session_token=") && cookie.toLowerCase().includes("httponly")), "Session token must be in an HttpOnly cookie");
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}
function passed(label: string) { groups++; console.log(`PASS ${label}`); }
const protectedRoutes: [string, string, (request: Request) => Promise<Response>][] = [
  ["/api/admin/bootstrap", "GET", routes.bootstrap.GET],
  ["/api/admin/records?entity=products", "GET", routes.records.GET],
  ["/api/admin/records", "POST", routes.records.POST],
  ["/api/admin/records", "PUT", routes.records.PUT],
  ["/api/admin/record?entity=products&id=missing", "GET", routes.record.GET],
  ["/api/admin/stock", "GET", routes.stock.GET],
  ["/api/admin/stock", "POST", routes.stock.POST],
  ["/api/admin/imports", "GET", routes.imports.GET],
  ["/api/admin/imports/preview", "POST", routes.preview.POST],
  ["/api/admin/imports/apply", "POST", routes.apply.POST],
];

try {
  const unavailable = await authPost(request("/api/auth/sign-in/email", "POST", { email: "admin@example.test", password }));
  assert.equal(unavailable.status, 503);
  assert.equal((await routes.bootstrap.GET(request("/api/admin/bootstrap"))).status, 503);
  for (const env of [
    { NODE_ENV: "production", BETTER_AUTH_SECRET: "x".repeat(40) },
    { NODE_ENV: "production", BETTER_AUTH_SECRET: "short", BETTER_AUTH_URL: "https://parts.example" },
    { NODE_ENV: "production", BETTER_AUTH_SECRET: "x".repeat(40), BETTER_AUTH_URL: "http://parts.example" },
    { NODE_ENV: "production", BETTER_AUTH_SECRET: "x".repeat(40), BETTER_AUTH_URL: "https://parts.example/untrusted" },
  ] satisfies NodeJS.ProcessEnv[]) assert.throws(() => readAuthEnvironment(env), InventoryError);
  passed("missing/invalid production auth configuration fails closed");

  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
  await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  const runtimeOptions = createAuthOptions(client);
  const bootstrap = betterAuth({
    ...runtimeOptions,
    emailAndPassword: { ...runtimeOptions.emailAndPassword, disableSignUp: false },
    user: {
      ...runtimeOptions.user,
      additionalFields: { role: { ...runtimeOptions.user.additionalFields.role, defaultValue: "admin" } },
    },
  });
  const admin = await bootstrap.api.signUpEmail({ body: { name: "Test Administrator", email: "admin@example.test", password } });
  const other = await bootstrap.api.signUpEmail({ body: { name: "Unapproved Account", email: "unapproved@example.test", password } });
  await client.execute({ sql: "UPDATE auth_user SET role = 'none' WHERE id = ?", args: [other.user.id] });
  assert.equal((await client.execute("SELECT count(*) AS count FROM auth_session")).rows[0].count, 0, "Bootstrap must not issue a session");
  const storedCredential = (await client.execute({ sql: "SELECT password FROM auth_account WHERE user_id = ? AND provider_id = 'credential'", args: [admin.user.id] })).rows[0].password;
  assert.equal(typeof storedCredential, "string");
  assert(storedCredential !== password && String(storedCredential).length > 40, "Plaintext passwords must never be stored");
  // Better Auth may return a synthetic response to prevent email enumeration;
  // verify the database invariant instead of requiring a particular HTTP error.
  await bootstrap.api.signUpEmail({ body: { name: "Overwrite attempt", email: "admin@example.test", password: "replacement-password-for-test" } });
  assert.equal((await client.execute({ sql: "SELECT password FROM auth_account WHERE user_id = ? AND provider_id = 'credential'", args: [admin.user.id] })).rows[0].password, storedCredential, "An existing credential must not be overwritten");
  passed("isolated bootstrap hashes credentials, issues no session and preserves existing accounts");

  for (const [path, method, handler] of protectedRoutes) {
    const headerVariants: Record<string, string>[] = [{}, { "oai-authenticated-user-id": "owner", "oai-authenticated-user-email": "admin@example.test", "x-actor": "admin" }];
    for (const extraHeaders of headerVariants) {
      const response = await handler(request(path, method, method === "GET" ? undefined : {}, undefined, extraHeaders));
      assert.equal(response.status, 401, `${method} ${path} must require a verified session`);
    }
  }
  passed("all ten admin read/write handlers reject anonymous and spoofed Sites identities");

  const signup = await authPost(request("/api/auth/sign-up/email", "POST", { name: "Uninvited", email: "public@example.test", password, role: "admin" }));
  assert(signup.status >= 400 && signup.status < 500, "Public signup must be disabled");
  assert.equal((await client.execute({ sql: "SELECT id FROM auth_user WHERE email = ?", args: ["public@example.test"] })).rows.length, 0);
  passed("public signup cannot create an account or request an admin role");

  const adminCookie = await signIn("admin@example.test");
  assert.equal(await requireAdminActor(request("/api/admin/bootstrap", "GET", undefined, adminCookie)), `staff:${admin.user.id}`);
  assert.equal((await routes.bootstrap.GET(request("/api/admin/bootstrap", "GET", undefined, adminCookie))).status, 200);
  const current = await authGet(request("/api/auth/get-session", "GET", undefined, adminCookie));
  assert.equal(current.status, 200);
  assert.equal((await current.json()).user.id, admin.user.id);
  passed("real email/password login and signed HttpOnly session authorize admin requests");

  const otherCookie = await signIn("unapproved@example.test");
  assert.equal((await routes.bootstrap.GET(request("/api/admin/bootstrap", "GET", undefined, otherCookie))).status, 403);
  await authPost(request("/api/auth/update-user", "POST", { name: "Unapproved Account", role: "admin" }, otherCookie));
  assert.equal((await client.execute({ sql: "SELECT role FROM auth_user WHERE id = ?", args: [other.user.id] })).rows[0].role, "none");
  assert.equal((await routes.bootstrap.GET(request("/api/admin/bootstrap", "GET", undefined, otherCookie))).status, 403);
  passed("unapproved users are denied and cannot edit their server-owned role");

  await client.execute({ sql: "UPDATE auth_user SET role = 'none' WHERE id = ?", args: [admin.user.id] });
  assert.equal((await routes.bootstrap.GET(request("/api/admin/bootstrap", "GET", undefined, adminCookie))).status, 403);
  await client.execute({ sql: "UPDATE auth_user SET role = 'staff' WHERE id = ?", args: [admin.user.id] });
  assert.equal((await routes.bootstrap.GET(request("/api/admin/bootstrap", "GET", undefined, adminCookie))).status, 200);
  passed("role removal takes effect immediately; explicit staff role permits access");

  const crossOrigin = await authPost(request("/api/auth/sign-in/email", "POST", { email: "admin@example.test", password }, undefined, { origin: "https://untrusted.example" }));
  assert.equal(crossOrigin.status, 403);
  const crossOriginWrite = await routes.records.POST(request("/api/admin/records", "POST", {}, adminCookie, { origin: "https://untrusted.example" }));
  assert.equal(crossOriginWrite.status, 403);
  passed("authentication and inventory writes reject an untrusted browser origin");

  const signedOut = await authPost(request("/api/auth/sign-out", "POST", {}, adminCookie));
  assert.equal(signedOut.status, 200);
  assert.equal((await routes.bootstrap.GET(request("/api/admin/bootstrap", "GET", undefined, adminCookie))).status, 401);
  assert.equal((await routes.bootstrap.GET(request("/api/admin/bootstrap", "GET", undefined, "olson-tenglund.session_token=forged"))).status, 401);
  passed("sign-out revokes the session; stale and forged cookies cannot authorize access");

  await client.execute("DELETE FROM auth_rate_limit");
  for (let index = 0; index < 5; index++) {
    const response = await authPost(request("/api/auth/sign-in/email", "POST", { email: "admin@example.test", password: "wrong-password-for-test" }, undefined, { "x-forwarded-for": `192.0.2.${index + 1}`, "x-vercel-forwarded-for": `198.51.100.${index + 1}` }));
    assert.equal(response.status, 401);
  }
  const anotherWorker = betterAuth(createAuthOptions(client));
  const throttled = await anotherWorker.handler(request("/api/auth/sign-in/email", "POST", { email: "admin@example.test", password }, undefined, { "x-forwarded-for": "203.0.113.99" }));
  assert.equal(throttled.status, 429, "Rate limits must survive a fresh auth instance and spoofed forwarding headers");
  assert(Number((await client.execute("SELECT count(*) AS count FROM auth_rate_limit")).rows[0].count) > 0);
  passed("database rate limits persist across instances and resist untrusted IP headers");

  console.log(`\n${groups} authentication integration groups passed.`);
} finally {
  client.close();
  await rm(directory, { recursive: true, force: true });
}
