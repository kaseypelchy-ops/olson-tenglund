#!/usr/bin/env node
/** Restore Year/Make/Model reference rows directly to the same Turso DB as EPA configs.
 * Run with --dry-run before committing. No changes to verified vehicles/fitments.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const HEADERS=['year','make','model','source','review_status','source_url'];
function parseCsv(text){
 const out=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=c;}
  else if(c==='"'){if(field)throw new Error('Unexpected quote in CSV');quoted=true;}
  else if(c===','){row.push(field);field='';}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);field='';if(row.some(x=>x!==''))out.push(row);row=[];}
  else field+=c;
 }
 if(quoted)throw new Error('Unterminated quoted field');
 if(row.length||field){row.push(field);out.push(row);}
 return out;
}
const norm = x => x.replace(/\s+/g,' ').trim().toLocaleLowerCase('en-US');
function prepare(values, n){
 if(values.length!==HEADERS.length)throw new Error(`Row ${n} has ${values.length} fields`);
 const [yearRaw,makeRaw,modelRaw,sourceRaw,statusRaw,urlRaw]=values;
 const year=Number(yearRaw),make=makeRaw.trim(),model=modelRaw.trim(),source=sourceRaw.trim()||'EPA FuelEconomy vehicle listing';
 if(!Number.isInteger(year)||year<1886||year>2100||!make||!model||make.length>130||model.length>200)throw new Error(`Invalid year/make/model at data row ${n}`);
 const url=urlRaw.trim();if(url&&(!url.startsWith('https://')||url.length>600))throw new Error(`Invalid URL at row ${n}`);
 const suffix=/\s+(AWD|FWD|RWD|4WD|2WD)$/i.exec(model);
 const display=suffix?model.slice(0,suffix.index).trim():model;
 const reference_key=createHash('sha256').update(`${year}|${norm(make)}|${norm(model)}`).digest('hex');
 return {reference_key,year,make,model,display_model:display,configuration_hint:suffix?suffix[1].toUpperCase():null,source_name:source,source_url:url||null};
}
async function main(){
 const args=process.argv.slice(2); const dryRun=args.includes('--dry-run');
 if(args.some(x=>x.startsWith('--')&&x!=='--dry-run'))throw new Error('Only --dry-run is supported');
 const file=args.find(x=>!x.startsWith('--'))||'data/vehicle_references.csv';
 const text=(await readFile(resolve(file),'utf8')).replace(/^\uFEFF/,'');
 const parsed=parseCsv(text);const headers=parsed.shift();
 if(JSON.stringify(headers)!==JSON.stringify(HEADERS))throw new Error('Unexpected CSV headers');
 const seen=new Set(),rows=[];let duplicates=0;
 for(let i=0;i<parsed.length;i++){const row=prepare(parsed[i],i+1);if(seen.has(row.reference_key)){duplicates++;continue;}seen.add(row.reference_key);rows.push(row);}
 console.log(`Validated ${parsed.length} source rows; ${rows.length} unique reference keys; ${duplicates} normalized duplicates skipped; dry run: ${dryRun}`);
 if(dryRun)return;
 const { createConfiguredClient }=await import('../db/libsql.mjs');
 const db=createConfiguredClient();
 try{
  const pre=await db.execute('SELECT COUNT(*) AS n FROM inv_vehicle_reference');
  const epa=await db.execute('SELECT COUNT(*) AS n FROM inv_vehicle_epa_config');
  console.log(`Before: references=${pre.rows[0].n}, EPA configs=${epa.rows[0].n}`);
  if(Number(epa.rows[0].n)===0)throw new Error('EPA table is empty in this connection. Refusing to import until database is checked.');
  const now=new Date().toISOString();
  for(let i=0;i<rows.length;i+=200){
   await db.batch(rows.slice(i,i+200).map(r=>({sql:`INSERT INTO inv_vehicle_reference
      (reference_key,year,make,model,display_model,configuration_hint,source_name,source_url,review_status,imported_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(reference_key) DO UPDATE SET source_name=excluded.source_name,source_url=excluded.source_url,display_model=excluded.display_model,configuration_hint=excluded.configuration_hint,updated_at=excluded.updated_at`,
    args:[r.reference_key,r.year,r.make,r.model,r.display_model,r.configuration_hint,r.source_name,r.source_url,'unreviewed',now,now]})),'write');
   if((i+200)%2000===0||i+200>=rows.length)console.log(`Reference records processed: ${Math.min(i+200,rows.length)}/${rows.length}`);
  }
  // Link exact source model strings only. These are CANDIDATE joins, not verified fitment.
  await db.execute(`UPDATE inv_vehicle_epa_config AS e
   SET reference_key=(SELECT v.reference_key FROM inv_vehicle_reference v WHERE v.year=e.year AND v.make=e.make AND v.model=e.model LIMIT 1),match_status='candidate_exact'
   WHERE e.match_status IN ('unmatched','candidate_exact') AND EXISTS
   (SELECT 1 FROM inv_vehicle_reference v WHERE v.year=e.year AND v.make=e.make AND v.model=e.model)`);
  const post=await db.execute('SELECT COUNT(*) AS n FROM inv_vehicle_reference');
  const counts=await db.execute('SELECT match_status,COUNT(*) AS n FROM inv_vehicle_epa_config GROUP BY match_status ORDER BY match_status');
  console.log(`Complete. Reference count: ${post.rows[0].n}`);
  console.log(JSON.stringify(counts.rows.map(r=>({status:r.match_status,count:Number(r.n)}))));
  console.log('No verified vehicle or product fitment records changed.');
 }finally{db.close();}
}
main().catch(err=>{console.error(err);process.exitCode=1;});
