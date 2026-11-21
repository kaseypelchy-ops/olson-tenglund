import { createHash, randomUUID } from 'node:crypto';
import { getActor, getDatabase, readJson } from './server';
import { InventoryError } from './validation';

const str=(v:unknown)=>v==null?'':String(v).trim();
const norm=(v:string)=>v.toLocaleLowerCase('en-US').replace(/\s+/g,' ');
type Incoming=Record<string,unknown>;
function parseRow(row:Incoming){
 const source_name=str(row.source_name),application_id=str(row.application_id),brand=str(row.brand),manufacturer_part_number=str(row.manufacturer_part_number),source_reference=str(row.source_reference),vehicle_key=str(row.vehicle_key),position=str(row.position),restrictions=str(row.restrictions);
 for(const [name,val,max] of [['source_name',source_name,180],['application_id',application_id,180],['brand',brand,150],['manufacturer_part_number',manufacturer_part_number,150],['source_reference',source_reference,500]] as const){if(!val || val.length>max)throw new Error(`${name} is required (maximum ${max} characters)`);}
 if(vehicle_key.length>120 || position.length>180 || restrictions.length>2000)throw new Error('Vehicle, position or restrictions field too long.');
 // APPLICATION ID must be stable per source, not an array position.
 const stage_key=createHash('sha256').update(`${norm(source_name)}|${application_id}`).digest('hex');
 return {stage_key,source_name,application_id,brand,manufacturer_part_number,source_reference,vehicle_key:vehicle_key||null,position:position||null,restrictions:restrictions||null};
}
export async function importFitmentFeed(request:Request){
 const body=await readJson(request);
 if((body.mode !== 'preview' && body.mode !== 'import') || !Array.isArray(body.rows) || body.rows.length<1 || body.rows.length>250)throw new InventoryError('Choose preview/import with 1â€“250 rows.',422);
 const parsed:ReturnType<typeof parseRow>[]=[];const keys=new Set<string>();const errors:{row:number;message:string}[]=[];
 for(let i=0;i<body.rows.length;i++)try{if(!body.rows[i]||typeof body.rows[i]!=='object'||Array.isArray(body.rows[i]))throw new Error('Expected CSV row object');const entry=parseRow(body.rows[i]);if(keys.has(entry.stage_key))throw new Error('Duplicate source/application ID in batch');keys.add(entry.stage_key);parsed.push(entry);}catch(e){errors.push({row:i+2,message:e instanceof Error?e.message:'Invalid application'});}
 if(errors.length)throw new InventoryError('Fitment import batch rejected. No records saved.',422,'invalid_fitment_feed',errors);
 if(body.mode==='preview')return {status:'preview',valid:parsed.length,saved:0};
 const db=getDatabase(), now=new Date().toISOString();
 const sql=`INSERT INTO inv_fitment_feed_stage(stage_key,source_name,application_id,brand,manufacturer_part_number,vehicle_key,position,restrictions,source_reference,review_status,last_imported_at)
 VALUES(?,?,?,?,?,?,?,?,?,'unreviewed',?)
 ON CONFLICT(stage_key) DO UPDATE SET brand=excluded.brand,manufacturer_part_number=excluded.manufacturer_part_number,vehicle_key=excluded.vehicle_key,position=excluded.position,restrictions=excluded.restrictions,source_reference=excluded.source_reference,last_imported_at=excluded.last_imported_at,
 review_status=CASE WHEN inv_fitment_feed_stage.brand<>excluded.brand OR inv_fitment_feed_stage.manufacturer_part_number<>excluded.manufacturer_part_number OR COALESCE(inv_fitment_feed_stage.vehicle_key,'')<>COALESCE(excluded.vehicle_key,'') OR COALESCE(inv_fitment_feed_stage.position,'')<>COALESCE(excluded.position,'') OR COALESCE(inv_fitment_feed_stage.restrictions,'')<>COALESCE(excluded.restrictions,'') OR inv_fitment_feed_stage.source_reference<>excluded.source_reference THEN 'unreviewed' ELSE inv_fitment_feed_stage.review_status END,
 reviewed_at=CASE WHEN inv_fitment_feed_stage.brand<>excluded.brand OR inv_fitment_feed_stage.manufacturer_part_number<>excluded.manufacturer_part_number OR COALESCE(inv_fitment_feed_stage.vehicle_key,'')<>COALESCE(excluded.vehicle_key,'') OR COALESCE(inv_fitment_feed_stage.restrictions,'')<>COALESCE(excluded.restrictions,'') THEN NULL ELSE inv_fitment_feed_stage.reviewed_at END,
 reviewed_by=CASE WHEN inv_fitment_feed_stage.brand<>excluded.brand OR inv_fitment_feed_stage.manufacturer_part_number<>excluded.manufacturer_part_number OR COALESCE(inv_fitment_feed_stage.vehicle_key,'')<>COALESCE(excluded.vehicle_key,'') OR COALESCE(inv_fitment_feed_stage.restrictions,'')<>COALESCE(excluded.restrictions,'') THEN NULL ELSE inv_fitment_feed_stage.reviewed_by END WHERE inv_fitment_feed_stage.linked_fitment_key IS NULL`;
 const statements=parsed.map(r=>db.prepare(sql).bind(r.stage_key,r.source_name,r.application_id,r.brand,r.manufacturer_part_number,r.vehicle_key,r.position,r.restrictions,r.source_reference,now));
 statements.push(db.prepare('INSERT INTO inv_audit_log(id,action,entity,record_key,summary,actor,created_at) VALUES(?,?,?,?,?,?,?)').bind(randomUUID(),'import','fitment_feed',null,`Staged ${parsed.length} supplier application rows (no fitments verified).`,getActor(request),now));
 await db.batch(statements);return {status:'staged',saved:parsed.length,fitmentsVerified:0};
}
export async function listFitmentFeed(request:Request){
 const q=str(new URL(request.url).searchParams.get('q'));
 const page=Math.max(1,Math.min(100000,Number(new URL(request.url).searchParams.get('page'))||1));
 if(q.length>120)throw new InventoryError('Search term too long.',422);
 const db=getDatabase(),pattern=`%${q.replace(/[\\%_]/g,'\\$&')}%`;
 const where=q?` WHERE (s.brand LIKE ? ESCAPE '\\' OR s.manufacturer_part_number LIKE ? ESCAPE '\\' OR s.application_id LIKE ? ESCAPE '\\')`:'';
 const args=q?[pattern,pattern,pattern]:[];
 const response=await db.prepare(`SELECT s.*,v.configuration_status AS vehicle_status,v.year AS vehicle_year,v.make AS vehicle_make,v.model AS vehicle_model FROM inv_fitment_feed_stage s LEFT JOIN inv_vehicles v ON v.vehicle_key=s.vehicle_key${where} ORDER BY s.last_imported_at DESC,s.stage_key LIMIT 50 OFFSET ?`).bind(...args,(page-1)*50).all();
 const filtered=await db.prepare(`SELECT COUNT(*) AS total FROM inv_fitment_feed_stage s${where}`).bind(...args).first<{total:number}>();
 return {records:response.results,total:Number(filtered?.total||0),page,pageSize:50};
}
export async function reviewFitmentFeed(request:Request){
 const body=await readJson(request),key=str(body.stage_key),status=str(body.status);
 if(!/^[0-9a-f]{64}$/.test(key)||!['reviewed','rejected'].includes(status))throw new InventoryError('Invalid stage key or review status.',422);
 const db=getDatabase(),row=await db.prepare('SELECT * FROM inv_fitment_feed_stage WHERE stage_key=?').bind(key).first<Record<string,unknown>>();
 if(!row)throw new InventoryError('Supplier application not found.',404);
 if(row.linked_fitment_key)throw new InventoryError('This application is already linked to a draft fitment; review it in Fitment applications.',409);
 await db.batch([
  db.prepare('UPDATE inv_fitment_feed_stage SET review_status=?,reviewed_at=?,reviewed_by=? WHERE stage_key=? AND linked_fitment_key IS NULL').bind(status,new Date().toISOString(),getActor(request),key),
  db.prepare('INSERT INTO inv_audit_log(id,action,entity,record_key,summary,actor,created_at) VALUES(?,?,?,?,?,?,?)').bind(randomUUID(),'review','fitment_feed',key,`Marked supplier application ${status}`,getActor(request),new Date().toISOString()),
 ]);
 return {status};
}
export async function promoteFitmentFeed(request:Request){
 const body=await readJson(request),key=str(body.stage_key);
 if(!/^[0-9a-f]{64}$/.test(key))throw new InventoryError('Invalid stage key.',422);
 const db=getDatabase(),row=await db.prepare('SELECT * FROM inv_fitment_feed_stage WHERE stage_key=?').bind(key).first<Record<string,unknown>>();
 if(!row)throw new InventoryError('Application not found.',404);
 if(row.linked_fitment_key)return {status:'already_linked',fitment_key:String(row.linked_fitment_key)};
 if(row.review_status!=='reviewed')throw new InventoryError('Review the source application before creating a draft.',409);
 if(!row.vehicle_key)throw new InventoryError('Map to an exact existing Verified Vehicles record (vehicle_key); EPA ID or Year/Make/Model is insufficient.',409);
 const vehicle=await db.prepare('SELECT vehicle_key FROM inv_vehicles WHERE vehicle_key=? AND configuration_status<>?').bind(String(row.vehicle_key),'archived').first<{vehicle_key:string}>();
 if(!vehicle)throw new InventoryError('Vehicle key not found in Verified Vehicles. Create/review the vehicle configuration first.',409);
 const part=await db.prepare('SELECT product_key,fitment_mode FROM inv_products WHERE brand_normalized=? AND mpn_normalized=?').bind(norm(String(row.brand)),norm(String(row.manufacturer_part_number))).first<{product_key:string;fitment_mode:string}>();
 if(!part)throw new InventoryError('Exact product brand + manufacturer number not found. Add the authorized supplier product first.',409);
 if(part.fitment_mode!=='vehicle_specific')throw new InventoryError('Product must have fitment mode vehicle_specific before a fitment application can be created.',409);
 const fitment_key='FF-'+key.slice(0,60);const now=new Date().toISOString();
 const existing=await db.prepare('SELECT fitment_key FROM inv_fitments WHERE fitment_key=?').bind(fitment_key).first<{fitment_key:string}>();
 if(existing)throw new InventoryError('This application key is already in use. Review it before proceeding.',409);
 await db.batch([
  db.prepare(`INSERT INTO inv_fitments(fitment_key,product_key,vehicle_key,position,required_base_units_milli,review_status,restrictions,restriction_status,source_name,source_reference,notes,revision,created_at,updated_at) VALUES(?,?,?,?,NULL,'draft',?,'unresolved',?,?,?,1,?,?)`).bind(fitment_key,part.product_key,vehicle.vehicle_key,row.position==null?null:String(row.position),row.restrictions==null?null:String(row.restrictions),String(row.source_name),String(row.source_reference),'Imported from reviewed supplier application. Requires separate fitment verification.',now,now),
  db.prepare('UPDATE inv_fitment_feed_stage SET linked_product_key=?,linked_fitment_key=? WHERE stage_key=? AND linked_fitment_key IS NULL').bind(part.product_key,fitment_key,key),
  db.prepare('INSERT INTO inv_audit_log(id,action,entity,record_key,summary,actor,created_at) VALUES(?,?,?,?,?,?,?)').bind(randomUUID(),'create_draft','fitments',fitment_key,'Created DRAFT application from supplier feed. Not verified or public.',getActor(request),now),
 ]);
 return {status:'created_draft',fitment_key,fitmentsVerified:0};
}

