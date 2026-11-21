"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Vehicle = { reference_key: string; year: number; make: string; model: string; display_model: string; configuration_hint: string | null };
type LibraryResult = { years: number[]; makes: string[]; total: number };
type GarageState = { version: 1; vehicles: Vehicle[]; activeKey: string | null };
const STORAGE_KEY = "olson-tenglund.garage.v1";
const emptyGarage: GarageState = { version: 1, vehicles: [], activeKey: null };
const fieldStyle: React.CSSProperties = { width: "100%", padding: "13px 12px", borderRadius: 8, border: "1px solid #b8c6d2", background: "white", color: "#152333", fontSize: 15 };
const primary: React.CSSProperties = { border: 0, borderRadius: 8, padding: "13px 18px", background: "#15324b", color: "white", fontWeight: 750, cursor: "pointer" };
const secondary: React.CSSProperties = { border: "1px solid #bccbd8", borderRadius: 8, padding: "10px 15px", background: "white", color: "#15324b", fontWeight: 650, cursor: "pointer" };
function label(v: Vehicle) { return `${v.year} ${v.make} ${v.display_model}${v.configuration_hint ? ` · ${v.configuration_hint}` : ""}`; }
function validVehicle(v: unknown): v is Vehicle {
  if (!v || typeof v !== "object") return false;
  const x = v as Partial<Vehicle>;
  return typeof x.reference_key === "string" && /^[a-f0-9]{64}$/.test(x.reference_key) && Number.isInteger(x.year) && typeof x.make === "string" && typeof x.model === "string" && typeof x.display_model === "string" && (x.configuration_hint == null || typeof x.configuration_hint === "string");
}
function readGarage(): GarageState {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null") as Partial<GarageState> | null;
    const vehicles = Array.isArray(saved?.vehicles) ? saved.vehicles.filter(validVehicle).slice(0, 20) : [];
    return { version: 1, vehicles, activeKey: vehicles.some(v => v.reference_key === saved?.activeKey) ? saved?.activeKey ?? null : vehicles[0]?.reference_key ?? null };
  } catch { return emptyGarage; }
}
export default function VehicleDirectory() {
  const [garage, setGarage] = useState<GarageState>(emptyGarage);
  const [loaded, setLoaded] = useState(false);
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [referenceKey, setReferenceKey] = useState("");
  const [years, setYears] = useState<number[]>([]);
  const [makes, setMakes] = useState<string[]>([]);
  const [models, setModels] = useState<Vehicle[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { setGarage(readGarage()); setLoaded(true); }, []);
  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(garage)); }
    catch { setError("Browser storage is unavailable. Saved vehicles won't persist after you leave this page."); }
  }, [garage, loaded]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/vehicle-directory", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Vehicle directory is unavailable. Please try again.");
      return response.json() as Promise<LibraryResult>;
    }).then(result => { setYears(result.years || []); setTotal(result.total); })
      .catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!year) { setMakes([]); return; }
    const controller = new AbortController();
    setError(""); setMakes([]);
    fetch(`/api/vehicle-directory?year=${encodeURIComponent(year)}`, { signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error("Could not load makes."); return r.json() as Promise<LibraryResult>; })
      .then(result => setMakes(result.makes || []))
      .catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [year]);
  useEffect(() => {
    if (!year || !make) { setModels([]); return; }
    const controller = new AbortController();
    setBusy(true); setModels([]); setError("");
    const params = new URLSearchParams({ year, make });
    fetch(`/api/vehicle-directory/options?${params.toString()}`, { signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error("Could not load model options."); return r.json() as Promise<{ models: Vehicle[] }>; })
      .then(result => setModels(result.models || []))
      .catch(e => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [year, make]);
  const selected = useMemo(() => models.find(v => v.reference_key === referenceKey), [models, referenceKey]);
  const active = garage.vehicles.find(v => v.reference_key === garage.activeKey);
  function addVehicle() {
    if (!selected) return;
    if (garage.vehicles.some(v => v.reference_key === selected.reference_key)) {
      setGarage(old => ({ ...old, activeKey: selected.reference_key })); setNotice("Vehicle is already saved. It is now your active vehicle."); return;
    }
    if (garage.vehicles.length >= 20) { setError("My Garage supports up to 20 vehicles on this device."); return; }
    setGarage(old => ({ version: 1, vehicles: [...old.vehicles, selected], activeKey: selected.reference_key }));
    setNotice(`${label(selected)} added to My Garage.`); setError("");
  }
  function removeVehicle(key: string) {
    setGarage(old => { const vehicles = old.vehicles.filter(v => v.reference_key !== key); return { version: 1, vehicles, activeKey: old.activeKey === key ? vehicles[0]?.reference_key ?? null : old.activeKey }; });
    setNotice("Vehicle removed from this browser's garage.");
  }
  return <main style={{ minHeight: "100vh", background: "#f2f5f7", color: "#182b3a", fontFamily: "Arial, sans-serif" }}>
    <header style={{ background: "#14212e", color: "white", padding: "18px max(20px, calc((100vw - 1100px)/2))", display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
      <Link href="/" style={{ color: "#efb737", textDecoration: "none", fontWeight: 800, fontSize: 22 }}>O&amp;T · OLSON &amp; TENGLUND</Link>
      <Link href="/" style={{ color: "white", textDecoration: "underline", fontWeight: 600 }}>Back to parts catalog</Link>
    </header>
    <div style={{ maxWidth: 1100, padding: "40px 20px 70px", margin: "auto" }}>
      <p style={{ textTransform: "uppercase", letterSpacing: 1.5, color: "#98660f", fontSize: 12, fontWeight: 800 }}>Vehicle directory &amp; saved vehicles</p>
      <h1 style={{ fontSize: "clamp(30px, 5vw, 46px)", margin: "10px 0 14px" }}>My Garage</h1>
      <p style={{ maxWidth: 820, color: "#566978", lineHeight: 1.65, marginBottom: 30 }}>Choose your vehicle from our reference directory and keep it saved for your next visit. A saved year, make and model is <strong>not</strong> confirmation that a part fits. Engine, trim and other application requirements are checked separately.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 22, alignItems: "start" }}>
        <section style={{ background: "white", borderRadius: 12, padding: 24, border: "1px solid #d9e2e8" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 24 }}>Add a vehicle</h2>
          <p style={{ margin: "0 0 20px", color: "#617484", lineHeight: 1.5 }}>Select a year, make and model. Some source model names include drivetrain details.</p>
          <div style={{ display: "grid", gap: 18 }}>
            <label style={{ display: "grid", gap: 7, fontWeight: 700 }}>Year
              <select style={fieldStyle} value={year} onChange={e => { setYear(e.target.value); setMake(""); setReferenceKey(""); setNotice(""); }}><option value="">Select year</option>{years.map(y => <option key={y} value={String(y)}>{y}</option>)}</select>
            </label>
            <label style={{ display: "grid", gap: 7, fontWeight: 700 }}>Make
              <select style={fieldStyle} value={make} disabled={!year} onChange={e => { setMake(e.target.value); setReferenceKey(""); setNotice(""); }}><option value="">Select make</option>{makes.map(m => <option key={m} value={m}>{m}</option>)}</select>
            </label>
            <label style={{ display: "grid", gap: 7, fontWeight: 700 }}>Model
              <select style={fieldStyle} value={referenceKey} disabled={!make || busy} onChange={e => { setReferenceKey(e.target.value); setNotice(""); }}><option value="">{busy ? "Loading models…" : "Select model"}</option>{models.map(m => <option key={m.reference_key} value={m.reference_key}>{m.display_model}{m.configuration_hint ? ` · ${m.configuration_hint}` : ""}</option>)}</select>
            </label>
            {selected && <p style={{ margin: 0, padding: 12, background: "#f4f7fa", borderRadius: 8, fontSize: 14 }}>Selected: <strong>{label(selected)}</strong></p>}
            <button style={{ ...primary, opacity: selected ? 1 : 0.5 }} disabled={!selected} onClick={addVehicle}>Save to My Garage</button>
          </div>
        </section>
        <section style={{ background: "white", borderRadius: 12, padding: 24, border: "1px solid #d9e2e8" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 24 }}>Saved vehicles ({garage.vehicles.length})</h2>
          <p style={{ color: "#617484", margin: "0 0 18px", lineHeight: 1.5 }}>Saved in this browser on this device. Account sync is not enabled.</p>
          {active && <div style={{ background: "#edf4fa", border: "1px solid #bdd3e2", padding: 13, borderRadius: 9, marginBottom: 18 }}><div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, color: "#346281" }}>ACTIVE VEHICLE</div><div style={{ fontWeight: 750, marginTop: 5 }}>{label(active)}</div></div>}
          {!loaded ? <p>Loading saved vehicles…</p> : garage.vehicles.length === 0 ? <p style={{ color: "#667783" }}>No saved vehicles yet. Choose a vehicle to get started.</p> :
            <div style={{ display: "grid", gap: 12 }}>{garage.vehicles.map(v => <div key={v.reference_key} style={{ border: "1px solid #e0e6ec", padding: 13, borderRadius: 8 }}>
              <div style={{ fontWeight: 750, marginBottom: 10 }}>{label(v)}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {garage.activeKey !== v.reference_key && <button style={secondary} onClick={() => { setGarage(old => ({ ...old, activeKey: v.reference_key })); setNotice("Active vehicle updated."); }}>Make active</button>}
                <button style={{ ...secondary, color: "#9b2633" }} onClick={() => removeVehicle(v.reference_key)}>Remove</button>
              </div>
            </div>)}</div>}
          <Link href="/#catalog" style={{ display: "inline-block", marginTop: 22, color: "#125a84", fontWeight: 700 }}>Browse parts</Link>
        </section>
      </div>
      {notice && <p role="status" style={{ marginTop: 18, color: "#175a37", fontWeight: 650 }}>{notice}</p>}
      {error && <p role="alert" style={{ marginTop: 18, color: "#a72a2a", fontWeight: 650 }}>{error}</p>}
      <section style={{ marginTop: 30, padding: "22px 24px", border: "1px solid #d9e2e8", background: "#fff", borderRadius: 12, lineHeight: 1.6 }}>
        <h2 style={{ fontSize: 19, marginTop: 0 }}>Vehicle reference coverage</h2>
        <p style={{ marginBottom: 8 }}>The directory currently contains {total == null ? "the imported reference records" : `${total.toLocaleString()} reference entries`}. Available years and models depend on which reference files have been imported.</p>
        <p style={{ marginBottom: 0 }}>The original EPA reference file covers 1984–2026, not every car ever sold. Model labels can include duplicates or drivetrain variants. Choosing a vehicle in My Garage does not automatically filter the product catalog by verified compatibility. Use the storefront's verified vehicle finder or contact the parts counter to confirm a specific part.</p>
      </section>
    </div>
  </main>;
}
