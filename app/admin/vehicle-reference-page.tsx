"use client";
import { useCallback, useEffect, useState } from "react";
import { FileSpreadsheet, Search, Upload, AlertCircle, Info } from "lucide-react";
import { parseCsv } from "@/lib/inventory/csv.mjs";

type ReferenceRow = { reference_key: string; year: number; make: string; model: string; display_model: string; configuration_hint: string | null; review_status: string; source_name: string };
type Listing = { records: ReferenceRow[]; total: number; page: number; pageSize: number; years: number[]; makes: string[] };
const requestError = async (response: Response) => { const body = await response.json().catch(() => ({})); return body?.error?.message || body?.message || `Request failed (${response.status}).`; };

export default function VehicleReferencePage() {
  const [year,setYear]=useState(""); const [make,setMake]=useState(""); const [q,setQ]=useState(""); const [search,setSearch]=useState(""); const [page,setPage]=useState(1);
  const [listing,setListing]=useState<Listing|null>(null); const [loading,setLoading]=useState(false); const [error,setError]=useState(""); const [refresh,setRefresh]=useState(0);
  const [file,setFile]=useState<File|null>(null); const [busy,setBusy]=useState(false); const [progress,setProgress]=useState({ processed:0,total:0 }); const [importMessage,setImportMessage]=useState("");
  const refreshList=useCallback(()=>setRefresh(x=>x+1),[]);
  useEffect(()=>{ const ctrl = new AbortController(); setLoading(true); setError(""); const params = new URLSearchParams({page:String(page)}); if(year)params.set("year",year); if(make)params.set("make",make); if(search)params.set("q",search);
    fetch(`/api/admin/vehicle-reference?${params}`,{signal:ctrl.signal}).then(async r=> { if(!r.ok)throw new Error(await requestError(r)); return r.json() as Promise<Listing>; }).then(x=>{setListing(x);setLoading(false);}).catch(e=>{if(e.name!=="AbortError"){setError(e.message);setLoading(false);}}); return ()=>ctrl.abort(); },[year,make,search,page,refresh]);
  async function importFile(){ if(!file||busy)return; setBusy(true);setError("");setImportMessage("");setProgress({processed:0,total:0});
    try {
      if(file.size>12_000_000)throw new Error("Use the EPA staging CSV (maximum 12 MB). Larger sources should be split before import.");
      const source=await file.text(); const lines=source.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").split("\n").filter(l=>l.length>0);
      if(lines.length<2)throw new Error("No data rows found.");
      // The EPA staging generator emits single-line CSV records. Each chunk is
      // parsed by the same strict CSV parser used by the existing import center.
      const headers=lines[0]; const cols=parseCsv(headers+"\n"+lines[1],{maxRows:250}).headers.map((h:string)=>h.toLowerCase());
      for(const required of ["year","make","model","source","review_status","source_url"]) if(!cols.includes(required))throw new Error(`Missing expected EPA staging column: ${required}`);
      const total=lines.length-1;setProgress({processed:0,total});
      for(let start=1; start<lines.length;start+=250){ const parsed=parseCsv(headers+"\n"+lines.slice(start,start+250).join("\n"),{maxRows:250});
        const rows=parsed.rows.map((record: Record<string,string>)=>Object.fromEntries(parsed.headers.map((h:string)=>[h.toLowerCase(),record[h]])));
        const response=await fetch("/api/admin/vehicle-reference",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rows})});
        if(!response.ok)throw new Error(`Batch ${Math.ceil(start/250)}: ${await requestError(response)}. Earlier batches remain saved. You may safely retry this file.`);
        setProgress({processed:Math.min(total,start+rows.length-1),total});
      }
      setImportMessage(`${total.toLocaleString()} reference rows processed. Existing matching references were updated; no verified vehicle configurations or fitments were changed.`);setFile(null);refreshList();
    } catch(e){setError(e instanceof Error?e.message:"Import failed. No success assumed.");}finally{setBusy(false);}
  }
  return <>
    <div className="ot-page-heading"><div><div className="ot-eyebrow">Vehicle reference data</div><h1>Year / make / model library</h1><p>Broad vehicle listings for browsing and future catalog mapping. These records are not verified fitment applications.</p></div></div>
    <div className="ot-note"><Info size={18}/><p>Separate from the existing <strong>Vehicle library</strong>. Importing these records never marks a product compatible or changes verified Buick applications. EPA coverage starts in 1984 and is not a complete 1980-to-present vehicle database.</p></div>
    <section className="ot-card" style={{padding:24,marginBottom:22}}>
      <h2 style={{fontSize:19,marginBottom:9}}>Bulk import vehicle references</h2>
      <p style={{fontSize:14,color:"#53677c",marginBottom:16}}>Choose <strong>epa_year_make_model_1984_2026_STAGING.csv</strong>. The file will be uploaded in 250-row batches; safe to rerun if interrupted. Keep this page open during import.</p>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}><input type="file" accept=".csv,text/csv" disabled={busy} aria-label="Vehicle reference CSV file" onChange={e=>setFile(e.target.files?.[0]||null)}/><button className="ot-button ot-button-primary" type="button" disabled={busy||!file} onClick={importFile}><Upload size={16}/>{busy?"Importing…":"Import staging CSV"}</button></div>
      {progress.total>0&&<div style={{marginTop:16}} role="status"><progress style={{width:"100%"}} max={progress.total} value={progress.processed}/><p>{progress.processed.toLocaleString()} of {progress.total.toLocaleString()} processed</p></div>}
      {importMessage&&<p role="status" style={{color:"#246f50",marginTop:12}}>{importMessage}</p>}
      {error&&<p role="alert" style={{color:"#a02d37",marginTop:12}}><AlertCircle size={15} style={{display:"inline",verticalAlign:"middle"}}/> {error}</p>}
    </section>
    <section className="ot-card"><div className="ot-toolbar" style={{flexWrap:"wrap",gap:10}}>
      <select className="ot-select" aria-label="Year" value={year} onChange={e=>{setYear(e.target.value);setMake("");setPage(1);}}><option value="">All years</option>{(listing?.years||[]).map(y=><option key={y}>{y}</option>)}</select>
      <select className="ot-select" aria-label="Make" disabled={!year} value={make} onChange={e=>{setMake(e.target.value);setPage(1);}}><option value="">All makes</option>{(listing?.makes||[]).map(m=><option key={m}>{m}</option>)}</select>
      <form style={{display:"flex",gap:7,flexGrow:1}} onSubmit={e=>{e.preventDefault();setPage(1);setSearch(q);}}><input style={{border:"1px solid #cbd5de",borderRadius:6,padding:9,flexGrow:1,minWidth:140}} placeholder="Search model" aria-label="Search model" value={q} onChange={e=>setQ(e.target.value)}/><button className="ot-button" type="submit"><Search size={16}/> Search</button></form>
      <span className="ot-result-count">{loading?"Loading…":`${(listing?.total||0).toLocaleString()} references`}</span></div>
      <div className="ot-table-scroll"><table className="ot-table"><thead><tr><th>Year</th><th>Make</th><th>Display model</th><th>Original model</th><th>Status</th><th>Source</th></tr></thead><tbody>{(listing?.records||[]).map(r=><tr key={r.reference_key}><td>{r.year}</td><td>{r.make}</td><td>{r.display_model}</td><td>{r.model}</td><td>{r.review_status}</td><td>{r.source_name}</td></tr>)}</tbody></table></div>
      {!loading&&!listing?.records.length&&<div style={{padding:24,color:"#53677c"}}>No matching vehicle references. Import the staging file or adjust your filters.</div>}
      <div className="ot-pagination"><span>Page {page} · {(listing?.total||0).toLocaleString()} references</span><div className="ot-pagination-actions"><button className="ot-button ot-button-small" type="button" disabled={page<=1||loading} onClick={()=>setPage(x=>x-1)}>Previous</button><button className="ot-button ot-button-small" type="button" disabled={loading||page*50>=(listing?.total||0)} onClick={()=>setPage(x=>x+1)}>Next</button></div></div>
    </section>
  </>;
}
