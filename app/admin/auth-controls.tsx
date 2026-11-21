"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import styles from "./auth-controls.module.css";

export default function AuthControls({ name }: { name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!response.ok) throw new Error("Sign-out failed");
      window.location.replace("/login");
    } catch {
      setError("Couldn’t sign out. Please try again.");
      setBusy(false);
    }
  }
  return <div className={styles.account}>
    <span className={styles.name} title={name}>{name}</span>
    <button className={styles.button} type="button" onClick={signOut} disabled={busy} aria-label={busy ? "Signing out" : "Sign out"}><LogOut size={16} /><span>{busy ? "Signing out…" : "Sign out"}</span></button>
    {error && <span className={styles.error} role="alert">{error}</span>}
  </div>;
}
