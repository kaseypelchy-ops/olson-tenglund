import Link from "next/link";
import { ArrowLeft, LockKeyhole, MapPin, ShieldCheck, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./login.module.css";

export function AuthShell({ children }: { children: ReactNode }) {
  return <main className={styles.page}>
    <section className={styles.brandPanel} aria-label="Olson & Tenglund">
      <Link className={styles.brand} href="/" aria-label="Olson and Tenglund storefront">
        <span className={styles.brandMark} aria-hidden="true">O&T</span>
        <span><strong>OLSON & TENGLUND</strong><small>INDEPENDENT AUTO PARTS</small></span>
      </Link>
      <div className={styles.brandContent}>
        <div className={styles.eyebrow}><Wrench size={17} /> THE STAFF WORKSPACE</div>
        <h1>Good service starts<br />with the right part.</h1>
        <p>One shared catalog. Three local stores. Everything your team needs to keep inventory in order.</p>
        <div className={styles.brandRule} />
        <div className={styles.locations}><MapPin size={19} /><span>Coudersport · Port Allegany · Smethport<small>PENNSYLVANIA</small></span></div>
      </div>
      <div className={styles.brandFooter}><ShieldCheck size={16} /> Authorized Olson & Tenglund staff</div>
    </section>
    <section className={styles.formPanel}>
      <Link className={styles.backLink} href="/"><ArrowLeft size={16} />Back to storefront</Link>
      <div className={styles.formCard}>{children}</div>
      <p className={styles.footer}>Olson & Tenglund, Inc. · Staff access</p>
    </section>
  </main>;
}

export function AuthUnavailable({ setup = false }: { setup?: boolean }) {
  return <AuthShell>
    <div className={styles.lockIcon}><LockKeyhole size={25} strokeWidth={1.7} /></div>
    <div className={styles.eyebrow}>STAFF ACCESS</div>
    <h2>{setup ? "Staff access is being set up" : "Sign-in is temporarily unavailable"}</h2>
    <p className={styles.intro}>{setup
      ? "The site administrator needs to finish the secure sign-in setup before this workspace can be opened."
      : "Please try again in a little while. If this continues, contact your site administrator."}</p>
    <Link href="/" className={styles.submit}>Return to storefront<ArrowLeft size={17} /></Link>
  </AuthShell>;
}
