# Original Sites source

`original-sites-source.zip` preserves the complete tracked source of the existing Olson & Tenglund ChatGPT Site at commit `3aab75ff2f7f9a826b27081f582240ec759f9e12`.

It is included for source history and comparison. The runnable Vercel project is the parent folder containing `package.json`, `app/`, `db/`, and `public/`.

The original snapshot targets the Sites/Cloudflare runtime and relies on that platform's private access boundary. It is not the Vercel deployment source. The portable parent project replaces those dependencies with Next.js, a hosted libSQL database, and explicit staff authentication.

This is a source archive, not a database backup or Git history. Hosted database files, credentials, dependencies, and runtime state are not included. The three current store records are separately preserved in `data/locations.json`; actual product inventory has not yet been supplied.
