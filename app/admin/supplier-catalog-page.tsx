"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Info, Search, Upload } from "lucide-react";
import { parseCsv } from "@/lib/inventory/csv.mjs";

type Product = {stage_key:string;supplier_key:string;supplier_part_number:string;brand:string;manufacturer_part_number:string;title:string;category:string;review_status:string;linked_product_key:string|null;unit_cost_cents:number|null;suggested_retail_cents:number|null};
type Listing={records:Product[];total:number;page:number;pageSize:number;counts:{review_status:string;count:number}[]};
const columns=["supplier_key","supplier_part_number","brand","manufacturer_part_number","title","category","description","barcode","image_url","unit_cost_usd","suggested_retail_usd","source_name","source_reference"];
const sample=columns.join(",")+"\nAUTO-VALUE,EXAMPLE-00001,Example Brand,EX-00001,Example filter,filters,TEST DATA - REPLACE,,,10.00,15.00,Authorized supplier export,DEMO-ONLY\n";
async function errorOf(r:Response){const x=await r.json().catch(()=>({}));const details=x?.error?.details;if(Array.isArray(details)&&details.length)return `${x?.error?.message||x?.message||"Request failed"}: ${details.slice(0,4).map((v:{row:number;message:string})=>`row ${v.row}: ${v.message}`).join("; ")}`;return x?.error?.message||x?.message||`Request failed (${r.status})`;}
function download(){const url=URL.createObjectURL(new Blob([sample],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download="supplier-catalog-template.csv";a.click();URL.revokeObjectURL(url);}
// Split on record boundaries outside quoted CSV cells. This preserves multiline
// product descriptions and literal commas; actual parsing uses shared parseCsv.
function csvRecords(raw:string){const s=raw.replace(/^\uFEFF/,"");const lines:string[]=[];let quoted=false,start=0;
  for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(quoted&&s[i+1]==='"'){i++;continue;}quoted=!quoted;}else if((c==='\n'||c==='\r')&&!quoted){const part=s.slice(start,i);if(part.trim())lines.push(part);if(c==='\r'&&s[i+1]==='\n')i++;start=i+1;}}
  if(quoted)throw new Error("CSV contains an unclosed quoted field.");if(start<s.length&&s.slice(start).trim())lines.push(s.slice(start));return lines;
}
function parseFile(text:string){const records=csvRecords(text);if(records.length<2)throw new Error("CSV needs a header and at least one data row.");
  const header=records[0];const test=parseCsv(header+"\n"+records[1],{maxRows:250});
  for(const required of ["supplier_key","supplier_part_number","brand","manufacturer_part_number","title","source_name"])if(!test.headers.includes(required))throw new Error(`Missing required column: ${required}`);
  const batches:Record<string,string>[][]=[];
  for(let i=1;i<records.length;i+=250){const parsed=parseCsv(header+"\n"+records.slice(i,i+250).join("\n"),{maxRows:250});batches.push(parsed.rows as Record<string,string>[]);}
  return batches;
}
export default function SupplierCatalogPage(){
  const [data,setData]=useState<Listing|null>(null),[q,setQ]=useState(""),[search,setSearch]=useState(""),[status,setStatus]=useState(""),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
  const [file,setFile]=useState<File|null>(null),[ready,setReady]=useState(false),[totalRows,setTotalRows]=useState(0),[running,setRunning]=useState(false),[progress,setProgress]=useState(0),[error,setError]=useState(""),[info,setInfo]=useState(""),[rowBusy,setRowBusy]=useState("");
  const refreshList=useCallback(()=>setRefresh(n=>n+1),[]);
  useEffect(()=>{const ctrl=new AbortController();const query=new URLSearchParams({page:String(page)});if(search)query.set("q",search);if(status)query.set("status",status);
    fetch(`/api/admin/supplier-catalog?${query}`,{signal:ctrl.signal}).then(async r=>{if(!r.ok)throw new Error(await errorOf(r));return r.json() as Promise<Listing>}).then(setData).catch(e=>{if(e.name!=="AbortError")setError(e.message)});return()=>ctrl.abort();},[page,search,status,refresh]);
  async function execute(mode:"preview"|"import"){if(!file||running)return;setRunning(true);setError("");setInfo("");setProgress(0);
    try{if(file.size>25_000_000)throw new Error("Choose a file under 25 MB or split your feed into multiple files.");const batches=parseFile(await file.text());setTotalRows(batches.reduce((n,b)=>n+b.length,0));
      for(const [i,rows] of batches.entries()){const r=await fetch("/api/admin/supplier-catalog",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,rows})});if(!r.ok)throw new Error(`Batch ${i+1}/${batches.length}: ${await errorOf(r)}. ${mode==="import"?"Earlier batches remain saved. You may safely retry the file.":"No rows were saved."}`);setProgress(p=>p+rows.length);}
      setReady(mode==="preview");setInfo(mode==="preview"?`All ${batches.reduce((n,b)=>n+b.length,0).toLocaleString()} rows validated without saving. Review the source and click Import to stage them.`:`Imported/refreshed ${batches.reduce((n,b)=>n+b.length,0).toLocaleString()} supplier rows. Nothing was published and no stock or fitment was changed.`);
      if(mode==="import") {setReady(false);setFile(null);refreshList();}
    }catch(e){setReady(false);setError(e instanceof Error?e.message:"Import failed.");}finally{setRunning(false);}}
  async function action(url:string,payload:Record<string,string>,key:string){setRowBusy(key);setError("");setInfo("");try{const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});if(!r.ok)throw new Error(await errorOf(r));const x=await r.json();setInfo(x.action==="created_draft"?"Added a draft product. Define its selling SKU, verified fitments and pricing separately before publishing.":x.action==="linked_existing"?"Linked to an existing branded product without overwriting it.":"Supplier record updated.");refreshList();}catch(e){setError(e instanceof Error?e.message:"Action failed.");}finally{setRowBusy("");}}
  return <>
    <div className="ot-page-heading"><div><div className="ot-eyebrow">Authorized supplier data</div><h1>Supplier product staging</h1><p>Prepare an Auto Value/distributor product feed without publishing unverified items or changing store stock.</p></div></div>
    <div className="ot-note"><Info size={18}/><p>Use only a distributor-approved export. This is not a MyPlace4Parts login or live supplier API. Costs remain in staff-only staging. No vehicle fitment is inferred from part names or the vehicle directory.</p></div>
    <section className="ot-card" style={{padding:24,marginBottom:22}}>
      <h2 style={{fontSize:19,marginBottom:8}}>Upload product master CSV</h2>
      <p style={{fontSize:14,color:"#53677c",marginBottom:14}}>Required: supplier_key, supplier_part_number, brand, manufacturer_part_number, title, source_name. Optional: category, description, barcode, image URL, costs and suggested retail. Upload the complete file; processing uses 250-row batches.</p>
      <button type="button" className="ot-button ot-button-small" onClick={download}><FileSpreadsheet size={16}/> Download example template</button>
      <div style={{display:"flex",flexWrap:"wrap",gap:10,alignItems:"center",marginTop:15}}>
        <input aria-label="Supplier catalog CSV" type="file" accept=".csv,text/csv" disabled={running} onChange={e=>{setFile(e.target.files?.[0]||null);setReady(false);setProgress(0);setInfo("");}} />
        <button type="button" className="ot-button" disabled={!file||running} onClick={()=>execute("preview")}><Search size={16}/>{running?"Working…":"Validate full file"}</button>
        <button type="button" className="ot-button ot-button-primary" disabled={!file||!ready||running} onClick={()=>execute("import")}><Upload size={16}/>Import to staging</button>
      </div>
      {(running||progress>0)&&<div style={{marginTop:14}} role="status"><progress max={totalRows||Math.max(progress,1)} value={progress} style={{width:"100%"}}/><p>{progress.toLocaleString()} rows processed{totalRows?` of ${totalRows.toLocaleString()}`:""}</p></div>}
    </section>
    {error&&<div className="ot-notice ot-error" role="alert"><AlertCircle size={18}/>{error}</div>}
    {info&&<div className="ot-notice" role="status"><CheckCircle2 size={18}/>{info}</div>}
    <section className="ot-card"><div className="ot-toolbar" style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <form style={{display:"flex",gap:8,flex:1}} onSubmit={e=>{e.preventDefault();setPage(1);setSearch(q);}}><input aria-label="Search supplier products" placeholder="Brand, part number, title" value={q} onChange={e=>setQ(e.target.value)} style={{padding:9,border:"1px solid #cbd5de",borderRadius:6,flex:1,minWidth:140}}/><button type="submit" className="ot-button"><Search size={16}/>Search</button></form>
      <select aria-label="Review status" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}} className="ot-select"><option value="">All review statuses</option><option value="unreviewed">Unreviewed</option><option value="reviewed">Reviewed</option><option value="rejected">Rejected</option></select><span className="ot-result-count">{(data?.total||0).toLocaleString()} supplier records</span></div>
      <div className="ot-table-scroll"><table className="ot-table"><thead><tr><th>Brand / part</th><th>Supplier item</th><th>Category</th><th>Cost (internal)</th><th>Review</th><th>Linked product</th><th>Action</th></tr></thead><tbody>
        {(data?.records||[]).map(r=><tr key={r.stage_key}><td><strong>{r.brand} {r.manufacturer_part_number}</strong><div>{r.title}</div></td><td>{r.supplier_key}<div>{r.supplier_part_number}</div></td><td>{r.category}</td><td>{r.unit_cost_cents===null?"—":`$${(r.unit_cost_cents/100).toFixed(2)}`}</td><td>{r.review_status}</td><td>{r.linked_product_key||"Not linked"}</td><td>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{r.review_status!=="reviewed"&&<button className="ot-button ot-button-small" type="button" disabled={!!rowBusy} onClick={()=>action("/api/admin/supplier-catalog/review",{stage_key:r.stage_key,status:"reviewed"},r.stage_key)}>Mark reviewed</button>}
          {r.review_status==="reviewed"&&!r.linked_product_key&&<button className="ot-button ot-button-small" type="button" disabled={!!rowBusy} onClick={()=>action("/api/admin/supplier-catalog/promote",{stage_key:r.stage_key},r.stage_key)}>Add draft product</button>}
          {r.review_status!=="rejected"&&!r.linked_product_key&&<button className="ot-button ot-button-small" type="button" disabled={!!rowBusy} onClick={()=>action("/api/admin/supplier-catalog/review",{stage_key:r.stage_key,status:"rejected"},r.stage_key)}>Reject</button>}</div>
        </td></tr>)}
      </tbody></table></div>
      {!data?.records.length&&<div style={{padding:24,color:"#53677c"}}>No supplier items match your filters. Start with an authorized CSV feed.</div>}
      <div className="ot-pagination"><span>Page {page} · {(data?.total||0).toLocaleString()} products</span><div className="ot-pagination-actions"><button className="ot-button ot-button-small" disabled={page===1} onClick={()=>setPage(v=>v-1)}>Previous</button><button className="ot-button ot-button-small" disabled={page*50>=(data?.total||0)} onClick={()=>setPage(v=>v+1)}>Next</button></div></div>
    </section>
  </>;
}
