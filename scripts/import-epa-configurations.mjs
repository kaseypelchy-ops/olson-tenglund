#!/usr/bin/env node
/** Import authoritative EPA fuel-economy configuration observations into isolated staging.
 * NO insertion into inv_vehicles, inv_fitments, products, or garages.
 * Run: node --env-file-if-exists=.env.local scripts/import-epa-configurations.mjs data/epa_vehicle_configurations.csv
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const COLS = ['epa_id','year','make','model','base_model','drive','transmission','transmission_description','engine_displacement_l','cylinders','fuel_type','fuel_type_primary','vehicle_class','engine_description','turbo','supercharger','alternative_vehicle_type','electric_motor','manufacturer_code'];
const INTEGER = new Set(['epa_id','year','cylinders']);
const REAL = new Set(['engine_displacement_l']);
function parseCsv(source) {
 const rows=[]; let row=[],field='',quoted=false;
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(quoted){if(c==='"'){if(source[i+1]==='"'){field+='"';i++;} else quoted=false;} else field+=c;}
  else if(c==='"'){if(field.length)throw new Error('Unexpected quote');quoted=true;}
  else if(c===','){row.push(field);field='';}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&source[i+1]==='\n')i++;row.push(field);field='';if(row.some(x=>x!==''))rows.push(row);row=[];}
  else field+=c;
 }
 if(quoted)throw new Error('Unclosed CSV quote');
 if(row.length||field){row.push(field);rows.push(row);}return rows;
}
function numeric(key,value,index){
 if(!value || value.toUpperCase()==='NA' || value.toUpperCase()==='N/A')return null;
 const num=Number(value);
 if(!Number.isFinite(num)||(INTEGER.has(key)&&!Number.isInteger(num)))throw new Error(`Invalid ${key} at data row ${index}`);
 return num;
}
async function main(){
 const args=process.argv.slice(2);const dryRun=args.includes('--dry-run');const file=args.find(x=>!x.startsWith('--'))||'data/epa_vehicle_configurations.csv';
 if(args.some(x=>x.startsWith('--')&&x!=='--dry-run'))throw new Error('Only --dry-run option is supported.');
 const raw=await readFile(resolve(file),'utf8');const parsed=parseCsv(raw.replace(/^\uFEFF/,''));
 const header=parsed.shift();if(JSON.stringify(header)!==JSON.stringify(COLS))throw new Error('The file must have the exact normalized EPA CSV headers.');
 const ids=new Set();const records=parsed.map((values,i)=>{
  if(values.length!==COLS.length)throw new Error(`Expected ${COLS.length} fields at data row ${i+1}; got ${values.length}`);
  const r=Object.fromEntries(COLS.map((key,j)=>[key,INTEGER.has(key)||REAL.has(key)?numeric(key,values[j],i+1):(values[j].trim()||null)]));
  if(!Number.isInteger(r.epa_id)||r.epa_id<=0||!Number.isInteger(r.year)||r.year<1886||r.year>2100||!r.make||!r.model)throw new Error(`Invalid required values at data row ${i+1}`);
  if(ids.has(r.epa_id))throw new Error(`Duplicate EPA id ${r.epa_id} at data row ${i+1}`);ids.add(r.epa_id);
  return r;
 });
 console.log(`Validated ${records.length} distinct EPA configurations; source: ${file}`);
 if(dryRun){console.log('Dry run only: database unchanged.');return;}
 const { createConfiguredClient } = await import('../db/libsql.mjs');
 const db=createConfiguredClient();
 try {
  const chk=await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('inv_vehicle_epa_config','inv_vehicle_reference')");
  if(chk.rows.length!==2)throw new Error('Missing EPA staging or vehicle-reference table. Run npm.cmd run db:migrate first.');
  const keys=COLS.join(',');const binds=COLS.map(()=>'?').join(',');const updates=COLS.filter(k=>k!=='epa_id').map(k=>`${k}=excluded.${k}`).join(',');
  const stamp=new Date().toISOString();let inserted=0;
  for(let offset=0;offset<records.length;offset+=200){
   const chunk=records.slice(offset,offset+200);
   const statements=chunk.map(r=>({sql:`INSERT INTO inv_vehicle_epa_config(${keys},imported_at,updated_at) VALUES(${binds},?,?) ON CONFLICT(epa_id) DO UPDATE SET ${updates},updated_at=excluded.updated_at`,args:[...COLS.map(k=>r[k]),stamp,stamp]}));
   await db.batch(statements,'write'); inserted+=chunk.length;
   if(inserted%2000===0||inserted===records.length)console.log(`Imported ${inserted}/${records.length}`);
  }
  // Exact year/make/model equality is a *candidate*, never verified fitment.
  const link=await db.execute(`UPDATE inv_vehicle_epa_config AS e
    SET reference_key=(SELECT v.reference_key FROM inv_vehicle_reference AS v WHERE v.year=e.year AND v.make=e.make AND v.model=e.model LIMIT 1),
        match_status='candidate_exact'
    WHERE e.match_status IN ('unmatched','candidate_exact')
    AND EXISTS(SELECT 1 FROM inv_vehicle_reference AS v WHERE v.year=e.year AND v.make=e.make AND v.model=e.model)`);
  const stats=await db.execute('SELECT match_status,COUNT(*) AS count FROM inv_vehicle_epa_config GROUP BY match_status ORDER BY match_status');
  console.log('Import complete. Reference matches are candidates only; no verified vehicles or fitments changed.');
  console.log(JSON.stringify(stats.rows.map(r=>({status:r.match_status,count:Number(r.count)}))));
 }finally{db.close();}
}
main().catch(err=>{console.error(`EPA import failed: ${err instanceof Error?err.message:'Unknown error'}`);process.exitCode=1;});
