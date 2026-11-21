'use client';
import {useCallback,useEffect,useState} from 'react';
import {parseCsv} from '@/lib/inventory/csv.mjs';
type Entry={stage_key:string;source_name:string;application_id:string;brand:string;manufacturer_part_number:string;vehicle_key:string|null;vehicle_year:number|null;vehicle_make:string|null;vehicle_model:string|null;vehicle_status:string|null;review_status:string;linked_fitment_key:string|null;restrictions:string|null};
type Listing={records:Entry[];total:number;page:number;pageSize:number};
const headers='source_name,application_id,brand,manufacturer_part_number,vehicle_key,position,restrictions,source_reference';
function rawRecords(raw:string){const src=raw.replace(/^\uFEFF/,'');const result:string[]=[];let quoted=false,start=0;for(let i=0;i<src.length;i++){const c=src[i];if(c==='"'){if(quoted&&src[i+1]==='"'){i++;continue;}quoted=!quoted;}else if((c==='\n'||c==='\r')&&!quoted){if(src.slice(start,i).trim())result.push(src.slice(start,i));if(c==='\r'&&src[i+1]==='\n')i++;start=i+1;}}if(quoted)throw new Error('Unclosed CSV quote.');if(src.slice(start).trim())result.push(src.slice(start));return result;}
async function errorMessage(response:Response){let data:any;try{data=await response.json();}catch{}return data?.error?.message||data?.message||`Request failed (${response.status})`;}
export default function FitmentFeedClient(){
 const [data,setData]=useState<Listing|null>(null),[file,setFile]=useState<File|null>(null),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[total,setTotal]=useState(0),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[actionBusy,setActionBusy]=useState('');
 const reload=useCallback(()=>setRefresh(n=>n+1),[]);
 useEffect(()=>{const controller=new AbortController();fetch(`/api/admin/fitment-feed?page=${page}`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error(await errorMessage(r));return r.json();}).then(setData).catch(e=>{if(e.name!=='AbortError')setStatus(e.message);});return()=>controller.abort();},[page,refresh]);
 async function send(mode:'preview'|'import'){
  if(!file||busy)return;setBusy(true);setStatus('');setProgress(0);
  try{if(file.size>25_000_000)throw new Error('Select a CSV smaller than 25MB.');const records=rawRecords(await file.text());if(records.length<2)throw new Error('File needs header and at least one data row.');const sample=parseCsv(records[0]+'\n'+records[1],{maxRows:250});for(const key of headers.split(','))if(!sample.headers.includes(key))throw new Error('Missing required column: '+key);
   const chunks:Record<string,string>[][]=[];for(let i=1;i<records.length;i+=250)chunks.push(parseCsv(records[0]+'\n'+records.slice(i,i+250).join('\n'),{maxRows:250}).rows as Record<string,string>[]);
   const rowCount=chunks.reduce((n,b)=>n+b.length,0);setTotal(rowCount);
   for(const [i,rows] of chunks.entries()){const response=await fetch('/api/admin/fitment-feed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,rows})});if(!response.ok)throw new Error(`Batch ${i+1} of ${chunks.length}: ${await errorMessage(response)}`);setProgress(p=>p+rows.length);}
   setStatus(mode==='preview'?`Validated ${rowCount.toLocaleString()} application records; no changes made.`:`Staged ${rowCount.toLocaleString()} applications. No fitments were verified.`);if(mode==='import'){setFile(null);reload();}
  }catch(e){setStatus(e instanceof Error?e.message:'Import failed.');}finally{setBusy(false);}
 }
 async function act(entry:Entry,kind:'reviewed'|'rejected'|'draft'){
  setActionBusy(entry.stage_key);setStatus('');try{const response=await fetch(kind==='draft'?'/api/admin/fitment-feed/promote':'/api/admin/fitment-feed',{method:kind==='draft'?'POST':'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(kind==='draft'?{stage_key:entry.stage_key}:{stage_key:entry.stage_key,status:kind})});if(!response.ok)throw new Error(await errorMessage(response));setStatus(kind==='draft'?'Created a DRAFT fitment. Open Fitment applications to review and verify it.':`Application marked ${kind}.`);reload();}catch(e){setStatus(e instanceof Error?e.message:'Action failed.');}finally{setActionBusy('');}
 }
 return <main style={{maxWidth:1250,margin:'0 auto',padding:'28px 20px',fontFamily:'system-ui, sans-serif',color:'#162c41'}}>
  <a href='/admin#fitments'>← Back to Fitment applications</a><p style={{color:'#8c6309',fontWeight:700,letterSpacing:2,fontSize:12,marginTop:28}}>AUTHORIZED APPLICATION DATA</p><h1 style={{fontSize:35,margin:'5px 0 12px'}}>Supplier fitment staging</h1>
  <p>Upload a distributor-authorized application export. Match each manufacturer part number to an existing product and each application to an explicit <strong>Verified Vehicles</strong> key. Only draft applications are created here. Nothing is published automatically.</p>
  <section style={{border:'1px solid #ced9e1',borderRadius:12,background:'#fff',padding:22,margin:'25px 0'}}>
   <h2>Import applications</h2><p style={{fontSize:14}}>CSV columns: <code>{headers}</code></p><p style={{fontSize:14}}>For real ACES XML, obtain the authorized feed and map its VCdb IDs, qualifier IDs and product identities before creating this normalized CSV. Do not use an EPA ID as vehicle_key.</p>
   <p><a href='/api/admin/fitment-feed' style={{display:'none'}}>API</a><button type='button' onClick={()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([headers+'\n'],{type:'text/csv'}));a.download='fitment-feed-template.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}}>Download blank CSV template</button></p>
   <input aria-label='Authorized fitment CSV' type='file' accept='.csv,text/csv' disabled={busy} onChange={e=>setFile(e.target.files?.[0]||null)}/>
   <div style={{display:'flex',gap:10,marginTop:14}}><button disabled={!file||busy} onClick={()=>send('preview')}>Validate file</button><button disabled={!file||busy} onClick={()=>send('import')}>Import to staging</button></div>
   {(busy||progress>0)&&<div style={{marginTop:12}}><progress value={progress} max={total||Math.max(1,progress)} style={{width:'100%'}}/><p>{progress.toLocaleString()} / {total.toLocaleString()}</p></div>}
  </section>
  {status&&<div role='status' style={{border:'1px solid #bed1df',padding:14,background:'#eef5fa',borderRadius:8,marginBottom:20}}>{status}</div>}
  <section style={{background:'#fff',border:'1px solid #ced9e1',borderRadius:12,padding:20,overflowX:'auto'}}><h2>Staged applications ({data?.total?.toLocaleString()??'…'})</h2><table style={{borderCollapse:'collapse',width:'100%',fontSize:13}}><thead><tr>{['Part','Source / application','Vehicle mapping','Restrictions','Review','Actions'].map(h=><th key={h} style={{textAlign:'left',padding:10,borderBottom:'1px solid #ddd'}}>{h}</th>)}</tr></thead><tbody>{(data?.records||[]).map(r=><tr key={r.stage_key}>
   <td style={{padding:10}}>{r.brand} <strong>{r.manufacturer_part_number}</strong></td><td style={{padding:10}}>{r.source_name}<br/>{r.application_id}</td><td style={{padding:10}}>{r.vehicle_key?(r.vehicle_year?`${r.vehicle_year} ${r.vehicle_make} ${r.vehicle_model}`:'Vehicle not found'):'Needs mapping'}<br/><small>{r.vehicle_key||'—'}</small></td><td style={{padding:10}}>{r.restrictions||'—'}</td><td style={{padding:10}}>{r.review_status}<br/><small>{r.linked_fitment_key?'Draft created':''}</small></td><td style={{padding:10,minWidth:170}}>{!r.linked_fitment_key&&<div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button disabled={!!actionBusy} onClick={()=>act(r,'reviewed')}>Review</button><button disabled={!!actionBusy} onClick={()=>act(r,'rejected')}>Reject</button>{r.review_status==='reviewed'&&<button disabled={!!actionBusy} onClick={()=>act(r,'draft')}>Create draft</button>}</div>}</td>
  </tr>)}</tbody></table>
  <div style={{display:'flex',justifyContent:'space-between',marginTop:20}}><button disabled={page===1} onClick={()=>setPage(x=>x-1)}>Previous</button><span>Page {page}</span><button disabled={page*50>=(data?.total||0)} onClick={()=>setPage(x=>x+1)}>Next</button></div></section>
  <p style={{marginTop:22,fontSize:14}}>Source applications with qualifiers or unknown VCdb-to-vehicle mappings must be reviewed manually. A staged record is never proof that a product fits.</p>
 </main>;
}
