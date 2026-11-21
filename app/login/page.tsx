import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { requireStaffUser } from "@/lib/auth";
import { InventoryError } from "@/lib/inventory/validation";
import AuthControls from "../admin/auth-controls";
import { AuthShell, AuthUnavailable } from "./auth-shell";
import LoginForm from "./login-form";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Staff sign-in | Olson & Tenglund, Inc.",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  let denied = false;
  try {
    await requireStaffUser(await headers());
    redirect("/admin");
  } catch (error) {
    if (!(error instanceof InventoryError)) throw error;
    if (error.status === 503) return <AuthUnavailable setup={error.code === "auth_not_configured"} />;
    if (error.status === 403) denied = true;
    else if (error.status !== 401) throw error;
  }
  return <AuthShell>
    <div className={styles.lockIcon}><LockKeyhole size={25} strokeWidth={1.7} /></div>
    <div className={styles.eyebrow}>INVENTORY & OPERATIONS</div>
    <h2>{denied ? "Staff access required" : "Welcome back"}</h2>
    <p className={styles.intro}>{denied
      ? "This account hasn’t been approved for the staff workspace. Contact your site administrator, or sign out to use another account."
      : "Sign in to manage your catalog, stock and shop accounts."}</p>
    {denied ? <AuthControls name="Current account" /> : <LoginForm />}
    <p className={styles.help}>Need an account or help signing in?<br />Contact your site administrator.</p>
  </AuthShell>;
}
