import { betterAuth } from "better-auth";
import { getLibsqlClient } from "../db/connection";
import { createAuthOptions, readAuthEnvironment } from "./auth-config";
import { InventoryError } from "./inventory/validation";

let auth: ReturnType<typeof createAuth> | undefined;

function createAuth() {
  // Check auth first, before opening any database connection.
  readAuthEnvironment();
  try {
    return betterAuth(createAuthOptions(getLibsqlClient()));
  } catch (error) {
    if (error instanceof InventoryError) throw error;
    throw new InventoryError("Staff sign-in has not been configured.", 503, "auth_not_configured");
  }
}

export function getAuth() {
  auth ??= createAuth();
  return auth;
}

export type StaffUser = { id: string; name: string; email: string; role: "admin" | "staff" };

export async function requireStaffUser(headers: Headers): Promise<StaffUser> {
  const authInstance = getAuth();
  let current;
  try {
    current = await authInstance.api.getSession({ headers });
  } catch {
    throw new InventoryError("Staff sign-in is temporarily unavailable. Please try again later.", 503, "auth_unavailable");
  }
  if (!current) throw new InventoryError("Sign in to the staff workspace to continue.", 401, "auth_required");
  const role = current.user.role;
  if (role !== "admin" && role !== "staff") {
    throw new InventoryError("This account does not have access to the staff workspace.", 403, "forbidden");
  }
  return { id: current.user.id, name: current.user.name, email: current.user.email, role };
}

// Used by every /api/admin/* handler, including read-only endpoints. Never
// accept an actor identity from headers, request bodies, or a client cache.
export async function requireAdminActor(request: Request): Promise<string> {
  const user = await requireStaffUser(request.headers);
  return `staff:${user.id}`;
}

export async function requireAdminPage(): Promise<StaffUser> {
  const { headers } = await import("next/headers");
  const { redirect } = await import("next/navigation");
  try {
    return await requireStaffUser(await headers());
  } catch (error) {
    if (error instanceof InventoryError && error.status === 401) redirect("/login");
    if (error instanceof InventoryError && error.status === 403) redirect("/login?error=access_denied");
    throw error;
  }
}
