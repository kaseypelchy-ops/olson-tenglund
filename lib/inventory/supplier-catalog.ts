import { createHash, randomUUID } from "node:crypto";
import { getActor, getDatabase, readJson } from "./server";
import { InventoryError } from "./validation";

export const CATEGORIES = ["brakes","batteries","filters","oil","wipers","ignition","electrical","engine","suspension","drivetrain","tools","accessories","other"] as const;
const catSet = new Set<string>(CATEGORIES);
const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const text = (v: unknown) => v === null || v === undefined ? "" : String(v).trim();
function money(value: unknown, label: string) {
  const v=text(value);
  if (!v) return null;
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(v)) throw new Error(`${label} must be a non-negative USD amount with at most two decimal places.`);
  const [d,c=""] = v.split(".");
  const cents = Number(d)*100+Number(c.padEnd(2,"0"));
  if (!Number.isSafeInteger(cents) || cents > 100000000000) throw new Error(`${label} is too large.`);
  return cents;
}
export type SupplierRow = Record<string, unknown>;
export function normalizeSupplierRow(raw: SupplierRow) {
  const supplier_key=text(raw.supplier_key), supplier_part_number=text(raw.supplier_part_number),
    brand=text(raw.brand), manufacturer_part_number=text(raw.manufacturer_part_number),
    title=text(raw.title), category=text(raw.category).toLowerCase()||"other",
    description=text(raw.description), barcode=text(raw.barcode), image_url=text(raw.image_url),
    source_name=text(raw.source_name),source_reference=text(raw.source_reference);
  for (const [label,value,max] of [["supplier_key",supplier_key,100],["supplier_part_number",supplier_part_number,150],["brand",brand,150],["manufacturer_part_number",manufacturer_part_number,150],["title",title,300],["source_name",source_name,180]] as const) {
    if(!value || value.length>max) throw new Error(`${label} is required and must be at most ${max} characters.`);
  }
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(supplier_key)) throw new Error("supplier_key must use letters, numbers, underscores, or hyphens.");
  if(!catSet.has(category)) throw new Error(`Unknown category: ${category}. Use the documented category values.`);
  if(description.length>3000 || barcode.length>120 || source_reference.length>500) throw new Error("Description, barcode or source reference exceeds its limit.");
  if(image_url && (!/^https:\/\//i.test(image_url) || image_url.length>1000)) throw new Error("image_url must be a valid HTTPS URL or blank.");
  const stage_key=createHash("sha256").update(`${normalize(supplier_key)}|${normalize(supplier_part_number)}`).digest("hex");
  return { stage_key,supplier_key,supplier_part_number,brand,manufacturer_part_number,title,category,
    description:description||null,barcode:barcode||null,image_url:image_url||null,
    unit_cost_cents:money(raw.unit_cost_usd,"unit_cost_usd"),
    suggested_retail_cents:money(raw.suggested_retail_usd,"suggested_retail_usd"),
    source_name,source_reference:source_reference||null };
}
type Item = ReturnType<typeof normalizeSupplierRow>;
function statementsFor(db: ReturnType<typeof getDatabase>, items: Item[], now:string) {
  return items.map(r=>db.prepare(`INSERT INTO inv_supplier_catalog_stage
  (stage_key,supplier_key,supplier_part_number,brand,manufacturer_part_number,title,category,description,barcode,image_url,unit_cost_cents,suggested_retail_cents,source_name,source_reference,review_status,last_imported_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'unreviewed',?)
  ON CONFLICT(stage_key) DO UPDATE SET
  supplier_key=excluded.supplier_key,supplier_part_number=excluded.supplier_part_number,
  brand=excluded.brand,manufacturer_part_number=excluded.manufacturer_part_number,
  title=excluded.title,category=excluded.category,description=excluded.description,barcode=excluded.barcode,
  image_url=excluded.image_url,unit_cost_cents=excluded.unit_cost_cents,
  suggested_retail_cents=excluded.suggested_retail_cents,source_name=excluded.source_name,
  source_reference=excluded.source_reference,last_imported_at=excluded.last_imported_at,
  review_status=CASE WHEN
    inv_supplier_catalog_stage.brand<>excluded.brand OR
    inv_supplier_catalog_stage.manufacturer_part_number<>excluded.manufacturer_part_number OR
    inv_supplier_catalog_stage.title<>excluded.title OR
    inv_supplier_catalog_stage.category<>excluded.category OR
    COALESCE(inv_supplier_catalog_stage.description,'')<>COALESCE(excluded.description,'') OR
    COALESCE(inv_supplier_catalog_stage.barcode,'')<>COALESCE(excluded.barcode,'') OR
    COALESCE(inv_supplier_catalog_stage.image_url,'')<>COALESCE(excluded.image_url,'')
    THEN 'unreviewed' ELSE inv_supplier_catalog_stage.review_status END,
  reviewed_at=CASE WHEN
    inv_supplier_catalog_stage.brand<>excluded.brand OR
    inv_supplier_catalog_stage.manufacturer_part_number<>excluded.manufacturer_part_number OR
    inv_supplier_catalog_stage.title<>excluded.title OR
    inv_supplier_catalog_stage.category<>excluded.category OR
    COALESCE(inv_supplier_catalog_stage.description,'')<>COALESCE(excluded.description,'') OR
    COALESCE(inv_supplier_catalog_stage.barcode,'')<>COALESCE(excluded.barcode,'') OR
    COALESCE(inv_supplier_catalog_stage.image_url,'')<>COALESCE(excluded.image_url,'')
    THEN NULL ELSE inv_supplier_catalog_stage.reviewed_at END,
  reviewed_by=CASE WHEN
    inv_supplier_catalog_stage.brand<>excluded.brand OR
    inv_supplier_catalog_stage.manufacturer_part_number<>excluded.manufacturer_part_number OR
    inv_supplier_catalog_stage.title<>excluded.title OR
    inv_supplier_catalog_stage.category<>excluded.category OR
    COALESCE(inv_supplier_catalog_stage.description,'')<>COALESCE(excluded.description,'') OR
    COALESCE(inv_supplier_catalog_stage.barcode,'')<>COALESCE(excluded.barcode,'') OR
    COALESCE(inv_supplier_catalog_stage.image_url,'')<>COALESCE(excluded.image_url,'')
    THEN NULL ELSE inv_supplier_catalog_stage.reviewed_by END`).bind(r.stage_key,r.supplier_key,r.supplier_part_number,r.brand,r.manufacturer_part_number,r.title,r.category,r.description,r.barcode,r.image_url,r.unit_cost_cents,r.suggested_retail_cents,r.source_name,r.source_reference,now));
}
export async function importSupplierCatalog(request: Request) {
  const body=await readJson(request);
  if(!Array.isArray(body.rows)||body.rows.length<1||body.rows.length>250) throw new InventoryError("Use 1–250 supplier catalog records per batch.",422);
  const checked:Item[]=[];const errors:{row:number;message:string}[]=[];const keys=new Set<string>();
  for(let i=0;i<body.rows.length;i++){
    try {if(!body.rows[i]||typeof body.rows[i]!=="object"||Array.isArray(body.rows[i]))throw new Error("Row must contain columns.");
      const item=normalizeSupplierRow(body.rows[i] as SupplierRow);
      if(keys.has(item.stage_key))throw new Error("Duplicate supplier part number in this batch.");
      keys.add(item.stage_key);checked.push(item);
    } catch(e){errors.push({row:i+2,message:e instanceof Error?e.message:"Invalid product."});}
  }
  if(errors.length)throw new InventoryError("Supplier batch rejected; no rows were saved.",422,"supplier_catalog_validation",errors);
  const dryRun=body.mode==="preview";
  if(body.mode!=="preview"&&body.mode!=="import")throw new InventoryError("Choose preview or import mode.",422);
  if(dryRun)return {valid:checked.length,errors:[],status:"preview",saved:0};
  const db=getDatabase(),now=new Date().toISOString(),actor=getActor(request);
  const tx=statementsFor(db,checked,now);
  tx.push(db.prepare("INSERT INTO inv_audit_log(id,action,entity,record_key,summary,actor,created_at) VALUES(?,?,?,?,?,?,?)").bind(randomUUID(),"supplier_feed_import","supplier_catalog",null,`Imported or refreshed ${checked.length} supplier catalog rows.`,actor,now));
  await db.batch(tx);
  return {valid:checked.length,status:"committed",saved:checked.length,productsPublished:0,stockChanged:0,fitmentsVerified:0};
}
export async function listSupplierCatalog(request: Request) {
  const params=new URL(request.url).searchParams;
  const q=text(params.get("q")),status=text(params.get("status"));const page=Math.max(1,Math.min(100000,Number(params.get("page"))||1));
  if(q.length>120 || (status&&!['unreviewed','reviewed','rejected'].includes(status)))throw new InventoryError("Invalid search filters.",422);
  const filters:string[]=[],args:(string|number)[]=[];
  if(status){filters.push("review_status=?");args.push(status);}
  if(q){filters.push("(brand LIKE ? ESCAPE '\\' OR manufacturer_part_number LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR supplier_part_number LIKE ? ESCAPE '\\')");const pattern=`%${q.replace(/[\\%_]/g,"\\$&")}%`;args.push(pattern,pattern,pattern,pattern);}
  const where=filters.length?" WHERE "+filters.join(" AND "):"";
  const db=getDatabase();
  const [records,counts,total]=await Promise.all([
    db.prepare(`SELECT * FROM inv_supplier_catalog_stage${where} ORDER BY last_imported_at DESC,stage_key LIMIT 50 OFFSET ?`).bind(...args,(page-1)*50).all(),
    db.prepare("SELECT review_status,COUNT(*) AS count FROM inv_supplier_catalog_stage GROUP BY review_status").all(),
    db.prepare(`SELECT COUNT(*) AS total FROM inv_supplier_catalog_stage${where}`).bind(...args).first<{total:number}>(),
  ]);
  return {records:records.results,total:Number(total?.total||0),page,pageSize:50,counts:counts.results};
}
export async function reviewSupplierCatalog(request: Request) {
  const body=await readJson(request),key=text(body.stage_key),status=text(body.status);
  if(!/^[0-9a-f]{64}$/.test(key)||!['reviewed','rejected','unreviewed'].includes(status))throw new InventoryError("Choose a valid supplier record and review status.",422);
  const db=getDatabase(),actor=getActor(request),now=new Date().toISOString();
  const results=await db.batch([
    db.prepare("UPDATE inv_supplier_catalog_stage SET review_status=?,reviewed_by=?,reviewed_at=? WHERE stage_key=? RETURNING stage_key").bind(status,status==='unreviewed'?null:actor,status==='unreviewed'?null:now,key),
    db.prepare("INSERT INTO inv_audit_log(id,action,entity,record_key,summary,actor,created_at) VALUES(?,?,?,?,?,?,?)").bind(randomUUID(),"supplier_catalog_review","supplier_catalog",key,`Set supplier catalog review to ${status}.`,actor,now)
  ]);
  if(!results[0].results.length)throw new InventoryError("Supplier record was not found.",404);
  return {stage_key:key,status};
}
/** Default sellable unit for supplier-promoted products. Keeps one item
 * per SKU and does not imply a retail price or a stock balance. */
export function suggestedInternalSku(brand: string, mpn: string, productKey: string): string {
  const safe = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  const base = `OT-${safe(brand).slice(0, 24)}-${safe(mpn).slice(0, 42)}-EA`;
  // If source identifiers contain no ordinary alphanumerics, use stable identity.
  return (!safe(brand) || !safe(mpn)) ? `OT-${createHash("sha256").update(productKey).digest("hex").slice(0, 18).toUpperCase()}-EA` : base;
}

export async function promoteSupplierCatalog(request:Request) {
  const body=await readJson(request),key=text(body.stage_key);
  if(!/^[0-9a-f]{64}$/.test(key))throw new InventoryError("Choose a valid supplier catalog record.",422);
  const db=getDatabase(),actor=getActor(request),now=new Date().toISOString();
  const row=await db.prepare("SELECT * FROM inv_supplier_catalog_stage WHERE stage_key=?").bind(key).first<Record<string,unknown>>();
  if(!row)throw new InventoryError("Supplier catalog record not found.",404);
  if(row.review_status!=="reviewed")throw new InventoryError("Review this product before adding it to the working catalog.",409);
  const norm=(x:unknown)=>normalize(String(x??""));
  const existing=await db.prepare("SELECT product_key FROM inv_products WHERE brand_normalized=? AND mpn_normalized=?")
    .bind(norm(row.brand),norm(row.manufacturer_part_number)).first<{product_key:string}>();
  const linkedKey=text(row.linked_product_key);
  if(linkedKey && existing?.product_key && linkedKey!==existing.product_key)
    throw new InventoryError("Supplier reference conflicts with a linked product. Review the record before continuing.",409);
  const productKey=linkedKey||existing?.product_key||`SUP-${key.slice(0,24)}`;
  const alreadyHasSku=await db.prepare("SELECT internal_sku FROM inv_skus WHERE product_key=? LIMIT 1")
    .bind(productKey).first<{internal_sku:string}>();
  let sku:string|null=alreadyHasSku?.internal_sku||null;
  const actions=[];
  const needsProduct=!linkedKey&&!existing;
  if(needsProduct)actions.push(db.prepare(`INSERT INTO inv_products(product_key,title,brand,manufacturer_part_number,category,description,base_unit_code,fitment_mode,publication_status,image_url,source_name,source_reference,brand_normalized,mpn_normalized,revision,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'each','unknown','draft',?,?,?,?,?,1,?,?)`)
    .bind(productKey,text(row.title),text(row.brand),text(row.manufacturer_part_number),text(row.category),row.description==null?null:text(row.description),row.image_url==null?null:text(row.image_url),row.source_name==null?null:text(row.source_name),row.source_reference==null?null:text(row.source_reference),norm(row.brand),norm(row.manufacturer_part_number),now,now));
  if(!sku){
    const proposed=suggestedInternalSku(text(row.brand),text(row.manufacturer_part_number),productKey);
    const occupying=await db.prepare("SELECT product_key FROM inv_skus WHERE internal_sku=?").bind(proposed).first<{product_key:string}>();
    sku=occupying&&occupying.product_key!==productKey
      ? `${proposed.slice(0,88)}-${createHash("sha256").update(productKey).digest("hex").slice(0,10).toUpperCase()}`
      : proposed;
    // The insert guard is evaluated in the write transaction: a concurrent
    // promotion cannot create a second SKU on the same product.
    actions.push(db.prepare(`INSERT INTO inv_skus(internal_sku,product_key,selling_unit,base_units_per_selling_unit_milli,condition,barcode,reorder_point_milli,status,notes,revision,created_at,updated_at)
      SELECT ?,?,'each',1000,'new',?,0,'active','Auto-created from reviewed supplier catalog; confirm packaging and barcode.',1,?,?
      WHERE NOT EXISTS(SELECT 1 FROM inv_skus WHERE product_key=?)`)
      .bind(sku,productKey,row.barcode==null?null:text(row.barcode),now,now,productKey));
  }
  if(!linkedKey)actions.push(db.prepare("UPDATE inv_supplier_catalog_stage SET linked_product_key=? WHERE stage_key=? AND linked_product_key IS NULL AND review_status='reviewed' RETURNING stage_key").bind(productKey,key));
  actions.push(db.prepare("INSERT INTO inv_audit_log(id,action,entity,record_key,summary,actor,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(randomUUID(),"supplier_catalog_promote","supplier_catalog",key,`Linked supplier record to product ${productKey}; ensured a default SKU if needed.`,actor,now));
  try {
    const results=await db.batch(actions);
    const updateIndex=needsProduct? (alreadyHasSku?1:2) : (alreadyHasSku?0:1);
    if(!linkedKey&&!results[updateIndex].results.length)
      throw new InventoryError("Catalog changed during approval. Refresh and retry.",409);
  }catch(e){if(e instanceof InventoryError)throw e;throw new InventoryError("The product or selling SKU may have been created concurrently. Refresh and retry; existing records were not overwritten.",409);}
  const resultingSku=await db.prepare("SELECT internal_sku FROM inv_skus WHERE product_key=? ORDER BY created_at,internal_sku LIMIT 1")
    .bind(productKey).first<{internal_sku:string}>();
  return {product_key:productKey,internal_sku:resultingSku?.internal_sku||null,
    action:linkedKey?"already_linked":existing?"linked_existing":"created_draft",
    publicationStatus:needsProduct?"draft":"unchanged",
    sellingSkuCreated:!alreadyHasSku&&Boolean(resultingSku),stockChanged:0};
}
