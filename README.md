# Olson & Tenglund, Inc.

Portable automotive storefront and staff inventory workspace for **Coudersport, Port Allegany, and Smethport, Pennsylvania**. This project runs independently of ChatGPT Sites and is prepared for a repository you own and a Vercel deployment you manage.

**The catalog starts empty.** No real products, prices, suppliers, stock counts, or vehicle applications have been supplied. The three stores have an explicit, repeatable seed command. Olson & Tenglund is presented as an independent parts business; no NAPA affiliation is assumed.

## What is included

- The existing storefront design, responsive styles, images, fonts, vehicle finder, store selector, and parts list.
- The inventory dashboard, product/SKU forms, vehicle configurations and fitment records, supplier offers, prices, shop account records, stock movements, and CSV import workflow.
- Standard Next.js with the Node runtime, a durable remote libSQL database connection, and tracked database migrations.
- Separate staff email/password sign-in, database-backed sessions, protected admin pages and APIs, sign-out, and a local command for creating authorized staff accounts.
- Location seed data for all three stores; unknown contact details remain blank.
- Setup instructions, an environment template, and automated verification scripts.
- The complete original tracked Sites source in `reference/original-sites-source.zip` for reference.

The storefront is public. `/admin` and all `/api/admin/*` endpoints require a valid staff/admin session. Public signup is disabled. Business-account records do **not** create customer logins or credit approval workflows.

## 1. Run it locally

Install **Node.js 24.x**. Extract this project, open a terminal in the folder containing `package.json`, then run:

```sh
npm ci
```

Copy `.env.example` to `.env.local`. On macOS/Linux:

```sh
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Generate a unique random secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste that value after `BETTER_AUTH_SECRET=` in `.env.local`. Keep the local database URL and `http://localhost:3000` for local development. Then run:

```sh
npm run db:migrate
npm run db:seed-locations
npm run admin:create
npm run dev
```

The account command asks for your name, email, and a password without echoing the password. Use an interactive terminal. It creates an authorized admin; there is no shared or default password. Re-run the command with a different email to create another authorized account. It refuses to overwrite an existing account.

Open [http://localhost:3000](http://localhost:3000) for the storefront and [http://localhost:3000/admin](http://localhost:3000/admin) for the inventory workspace. Sign in with the account you just created.

Local data stays in `local.db`, which Git ignores. A local file is for development only. Production deliberately rejects file-backed or in-memory database configuration.

## 2. Put the source in your GitHub repository

Create your repository in your own GitHub account. For the simplest initial push, create it empty, without a generated README, license, or gitignore. From the extracted project folder:

```sh
git init
git add .
git commit -m "Add Olson and Tenglund storefront and inventory workspace"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

Replace the example repository URL with yours. Authenticate to GitHub using your normal local Git or GitHub Desktop setup. A ChatGPT GitHub connection is not required.

You can also use GitHub Desktop to add this folder and publish the repository. Upload the **extracted project files**, not just this ZIP. `package.json` should be at the repository root. Include `.gitignore`, `.env.example`, and the other configuration files; exclude `.env.local`, local database files, `node_modules`, and `.next`.

## 3. Prepare the production database and staff account

This port uses **Turso/libSQL**, preserving the existing SQLite schema and transaction rules. Vercel hosts the application; the remote database stores products, stock history, imports, staff accounts, and sessions.

1. Create a hosted Turso database in your own account and obtain its database URL and auth token. A standard hosted libSQL-compatible database can also be used.
2. Temporarily set the four production values below in your local `.env.local` so the maintenance commands target that remote database. Keep a private copy of your development settings if needed.
3. Run the following against the remote database:

```sh
npm run db:migrate
npm run db:seed-locations
npm run admin:create
```

These commands are explicit maintenance operations. They are **not** run during application startup or Vercel builds. The seed command creates missing stores, leaves existing records intact, and can be repeated. The migration command tracks checksums and applies only pending migrations; it refuses changed or reordered migration history.

The local development database is not uploaded automatically. For this initial handoff, the business dataset consists of the three supplied stores. The product catalog remains empty until you enter records or import inventory.

## 4. Deploy through your Vercel account

You can deploy this folder directly through the Vercel CLI **without linking GitHub to Vercel**. From the project folder, run:

```sh
npx vercel login
npx vercel link
```

Choose your own Vercel account/team and create or select the project when prompted. This associates the local folder with your Vercel project; it does not connect your GitHub repository. Configure the environment variables below in that project's dashboard and prepare the remote database as described above. Then deploy:

```sh
npx vercel --prod
```

If you later want deployments triggered by Git pushes, importing the GitHub repository through Vercel is an optional alternative.

Use the **Next.js** framework preset, the project folder as the root directory, and **Node.js 24.x**. The checked-in `vercel.json` selects `npm ci` and `npm run build`; leave the output directory at Vercel's Next.js default.

Set these **server-only** environment variables:

| Variable | Production value |
| --- | --- |
| `TURSO_DATABASE_URL` | Your remote `libsql://...` database URL |
| `TURSO_AUTH_TOKEN` | The remote database auth token |
| `BETTER_AUTH_SECRET` | A unique random secret of at least 32 characters; use the same value for this deployment's maintenance/setup commands |
| `BETTER_AUTH_URL` | Your exact canonical HTTPS origin, for example `https://parts.example.com`, without a path or trailing slash |

Do not prefix these names with `NEXT_PUBLIC_`. Do not put secret values in source files, commit messages, or the repository.

Set `BETTER_AUTH_URL` to the stable production Vercel domain or your custom domain. If you initially deploy before you know the assigned domain, add the correct value and redeploy before signing in. Update it and redeploy whenever you change the canonical domain. Staff should use that canonical origin; arbitrary preview URLs are not trusted sign-in origins.

Use a separate database and secret for preview deployments that will exercise admin features. Give each such deployment its exact canonical auth URL. An unconfigured preview can render the storefront design but cannot access catalog data or staff functions.

After deployment, check `/`, `/login`, and `/admin`. The admin page should require sign-in, and the three locations should appear after seeding. Migrations and account creation must finish before staff can use the application.

These are setup instructions for **your own** GitHub and Vercel accounts. No repository or deployment has been created by this handoff.

## Everyday inventory work

See [docs/INVENTORY.md](docs/INVENTORY.md) for the data model, stock controls, publication checks, and CSV workflow.

Start in this order:

1. Confirm each store's contact details in **Stock locations**.
2. Create/import products, then selling SKUs and specifications.
3. Add prices, suppliers, and supplier offers as needed.
4. Import reviewed vehicle configurations and their fitment applications.
5. Add opening stock for each SKU/store position.
6. Review and publish ready products to make them visible in the storefront.

The generic importer accepts UTF-8 CSV, up to **250 data rows per batch**, with explicit column mapping, validation, and an apply step. Imports are create-only and atomic. XLSX, ACES, and PIES ingestion are separate future work. Keep identifiers such as part numbers, barcodes, and SKUs as text.

Products/SKUs are shared across stores; stock balances are kept separately by location and disposition. Supplier stock is not local stock. The storefront distinguishes an unknown local quantity from a recorded zero.

## Current scope

The project provides a working catalog, fitment data model, inventory workspace, and import foundation. The browser parts list does not submit an order, reserve inventory, process payments, or promise fulfillment. Customer login, wholesale self-service/approval, tax/shipping calculation, payments, order fulfillment, supplier synchronization, and licensed fitment feeds have not been implemented.

Staff email/password login is included. Self-service password recovery and invitation email delivery are not configured. Staff and admin roles currently have the same inventory access; granular employee permissions would be an additional feature.

The included automotive imagery is design artwork, not evidence of actual inventory or photos of the three stores. Coudersport and Smethport contact details remain blank where not supplied. Port Allegany retains the contact information from the existing site; confirm all business details and policies before launch.

## Project map

| Path | Purpose |
| --- | --- |
| `public/storefront/` | Storefront HTML, CSS, JavaScript, fonts, and images |
| `next.config.ts` | Root rewrite to the storefront and response headers |
| `app/admin/` | Staff workspace, forms, tables, stock controls, imports |
| `app/login/`, `app/api/auth/`, `lib/auth*.ts` | Staff login, session checks, authorization |
| `app/api/admin/` | Protected record, stock, bootstrap, and import endpoints |
| `app/api/catalog/`, `app/api/locations/` | Public catalog, vehicle filters, store information |
| `lib/inventory/` | Business rules, validation, queries, CSV handling |
| `db/schema.ts`, `db/auth-schema.ts` | Inventory and authentication schemas |
| `db/libsql.mjs`, `db/connection.ts` | Shared database configuration and real libSQL transaction adapter |
| `drizzle/` | Versioned SQL migrations, snapshots, and journal |
| `data/locations.json` | Three-store seed data |
| `scripts/` | Explicit setup commands and verification runners |
| `reference/original-sites-source.zip` | Original tracked Sites source snapshot |

## Validation and future changes

```sh
npm run typecheck
npm test
npm run build
```

The tests create disposable local databases and exercise parser, inventory, transaction, and authentication behavior. They do not operate on the production database. See [tests/README.md](tests/README.md) and [docs/VERIFICATION.md](docs/VERIFICATION.md) for the tested scope and handoff results.

The production build intentionally succeeds without credentials; runtime data and staff access fail closed until configured. To run `npm start` locally in production mode, provide a durable remote database and a canonical HTTPS auth origin. Use `npm run dev` for normal local file-backed development.

For a schema change, edit the Drizzle schema, run `npm run db:generate`, review the new SQL, test it on a disposable database, and run `npm run db:migrate` against the intended environment before releasing dependent code. Do not edit already applied migrations or use schema-push commands against an established database. Back up production data before schema changes. The migration runner deliberately stops table rebuilds that change foreign-key/transaction settings for explicit review.

## Official references

- [Vercel: Next.js deployment](https://vercel.com/docs/frameworks/full-stack/nextjs)
- [Vercel: deploying from the CLI](https://vercel.com/docs/cli/deploying-from-cli)
- [Vercel: optional Git integration](https://vercel.com/docs/git)
- [Turso: TypeScript/libSQL SDK](https://docs.turso.tech/sdk/ts/reference)
- [Better Auth: email and password](https://www.better-auth.com/docs/authentication/email-password)
- [Better Auth: Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle)
