import type { Client } from "@libsql/client";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/libsql";
import * as authSchema from "../db/auth-schema";
import { InventoryError } from "./inventory/validation";

export function readAuthEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new InventoryError("Staff sign-in has not been configured.", 503, "auth_not_configured");
  }
  const production = env.NODE_ENV === "production" || Boolean(env.VERCEL);
  const rawOrigin = env.BETTER_AUTH_URL?.trim() || (production ? "" : "http://localhost:3000");
  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    throw new InventoryError("Staff sign-in has not been configured.", 503, "auth_not_configured");
  }
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
      !["http:", "https:"].includes(origin.protocol) || (production && origin.protocol !== "https:")) {
    throw new InventoryError("Staff sign-in has not been configured.", 503, "auth_not_configured");
  }
  return { secret, baseURL: origin.origin, production };
}

// The runtime configuration ALWAYS disables public signup. The local bootstrap
// script creates a separate instance; no environment variable can open signup.
export function createAuthOptions(client: Client, env: NodeJS.ProcessEnv = process.env) {
  const { secret, baseURL, production } = readAuthEnvironment(env);
  return {
    appName: "Olson & Tenglund Staff",
    secret,
    baseURL,
    basePath: "/api/auth",
    trustedOrigins: [baseURL],
    database: drizzleAdapter(drizzle(client, { schema: authSchema }), {
      provider: "sqlite",
      schema: authSchema,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "none", input: false },
      },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
      },
    },
    advanced: {
      useSecureCookies: production || baseURL.startsWith("https://"),
      cookiePrefix: "olson-tenglund",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      // Vercel overwrites this header at its trusted edge. Outside Vercel use a
      // shared per-path bucket instead of trusting arbitrary forwarded headers.
      ipAddress: { ipAddressHeaders: env.VERCEL === "1" ? ["x-vercel-forwarded-for"] : [] },
    },
  } satisfies BetterAuthOptions;
}
