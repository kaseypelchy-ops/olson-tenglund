# Inventory and persistence checks

Run the CSV parser/export checks with `npm run test:csv` and the inventory suite
with `npm run test:inventory` on Node 24. `npm test` also runs the separate
authentication suite.

The inventory runner bundles the actual API route handlers and uses the shipped
`db/libsql.mjs` adapter with `@libsql/client` against a disposable database file.
It applies the checked-in Drizzle migration journal with the same checksum-aware
runner used by `npm run db:migrate`. It opens no HTTP listener. Global network
fetch is disabled, and all test database files and compiled fixtures are deleted
when the run ends. It never uses the configured hosted database or its token.

## What the inventory suite verifies

- Draft defaults, leading-zero part identifiers, unique part identities, linked
  records, publication prerequisites, and optimistic revisions.
- Exact money, overlapping prices, physical opening counts, stock floors,
  adjustment retries, and protection against changing units after stock history.
- Atomic imports, repeated application, duplicate keys, reviewed vehicle facets,
  incomplete configurations, manual fitment qualifiers, and public field privacy.
- Individual-store stock, recorded zero versus unknown, exclusion of internal or
  archived locations, and filtered staff stock totals.
- Real libSQL `RETURNING` values, named result rows, foreign keys, `changes()`
  audit ordering, and transactional rollback.
- Migration idempotency, SQL checksum drift, rollback of a failed schema change,
  create-only location seeding, and persistence after all clients are closed.
- Rejection of ephemeral database URLs in production and controlled missing
  database configuration responses.

Two deterministic race checks let a separate real libSQL client commit a price
or stock conflict after application validation but before import application.
They verify that a later constraint failure rolls back every earlier row in the
import and does not create a success audit entry. These checks exercise concrete
SQL interleavings; they are not a distributed-system load test.

## Authentication boundary in these tests

For the inventory suite only, the esbuild test configuration replaces the auth
dependency with `tests/inventory-auth-fixture.ts`. The fixture authorizes the
test's `Request` objects in memory; it does not inspect a special header, cookie,
or environment bypass flag. The production app imports the real auth module.
Anonymous test requests verify that admin routes reject spoofed identity headers
and that the public catalog, vehicle facets, and store directory remain public.

`npm run test:auth` exercises the actual session and staff-role implementation.
The inventory fixture alone does not verify Better Auth sessions. Neither suite
claims to test a deployed Turso/Vercel environment or a browser checkout flow.
# Authentication integration coverage

`npm run test:auth` runs `scripts/test-auth.ts` with the pinned Better Auth library, the actual `/api/auth/*` handlers and all ten existing admin route methods. It creates a disposable local libSQL database, applies every tracked migration and deletes the database when finished. It never reads a real inventory database or uses the inventory suite's authorization fixture.

The ten test groups verify:

- Missing secrets, missing production origin, a short secret, an insecure production origin and a URL containing an unexpected path all fail closed.
- The isolated bootstrap configuration hashes credentials, creates no browser session and preserves an existing account's credential.
- Every admin read/write route denies anonymous requests and forged Sites identity headers.
- Public registration is disabled, including attempts to submit an admin role.
- Real email/password sign-in returns an HttpOnly signed session cookie and authorizes staff access.
- An existing account without an explicit approved role is denied and cannot change its own role through the auth API.
- Role removal immediately denies the same session; an explicit `staff` role permits access.
- Auth requests and inventory writes reject an untrusted browser origin.
- Sign-out revokes the session; a copied old cookie or forged cookie cannot authorize another request.
- Login rate limits live in the database, remain effective across separate auth instances and cannot be bypassed using untrusted forwarding headers outside Vercel.

The limiter's shared-bucket warning is expected in local tests, where no trusted proxy supplies an IP. Invalid-origin and invalid-password warnings are expected negative-test outcomes. The test output never includes passwords, hashes or session tokens.

These tests verify the application and local libSQL driver. They do not claim a hosted Turso/Vercel deployment has been tested; perform the documented live smoke checks after configuring those services.
