"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import styles from "./login.module.css";

export default function LoginForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: String(data.get("email") || "").trim(), password: data.get("password"), rememberMe: false }),
      });
      if (!response.ok) {
        setError(response.status === 429
          ? "Too many sign-in attempts. Wait a minute, then try again."
          : response.status >= 500
          ? "Sign-in is temporarily unavailable. Please try again later."
          : "We couldn’t sign you in. Check your email and password and try again.");
        return;
      }
      // A full navigation makes the server verify the new session and staff role.
      window.location.replace("/admin");
    } catch {
      setError("We couldn’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return <form className={styles.form} onSubmit={submit} aria-busy={busy}>
    {error && <div className={styles.error} role="alert"><AlertCircle size={18} /><span>{error}</span></div>}
    <div className={styles.field}><label htmlFor="staff-email">Email address</label><input id="staff-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} disabled={busy} placeholder="you@example.com" /></div>
    <div className={styles.field}><label htmlFor="staff-password">Password</label><div className={styles.passwordField}>
      <input id="staff-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required maxLength={128} disabled={busy} />
      <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} disabled={busy}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
    </div></div>
    <button className={styles.submit} type="submit" disabled={busy}>{busy ? <><LoaderCircle size={18} className={styles.spinner} />Signing in…</> : <>Sign in to workspace<ArrowRight size={18} /></>}</button>
  </form>;
}
