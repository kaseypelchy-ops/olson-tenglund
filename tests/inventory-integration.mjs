/** Local-only integration checks. Never point this at a hosted or real inventory database. */
import assert from 'node:assert/strict';
export async function runInventoryIntegration({ testFetch, origin = 'http://127.0.0.1:4173', environment = 'disposable-local-libsql' } = {}) {
assert.equal(typeof testFetch, 'function', 'Use the network-disabled inventory runner; a local test dispatcher is required.');
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname), 'Integration fixtures are restricted to local development.');
const prefix = 'QA-' + Date.now().toString(36);
let passed = 0;
async function request(path, body, method = body ? 'POST' : 'GET') {
  const response = await testFetch(origin + path, {method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  const data = await response.json(); return {status:response.status,ok:response.ok,data};
}
async function good(path,body,method) { const r=await request(path,body,method); assert.ok(r.ok, JSON.stringify({path,status:r.status,error:r.data})); return r.data; }
async function bad(path,body,method) { const r=await request(path,body,method); assert.ok(r.status >= 400 && r.status < 500, 'Expected a controlled client rejection: '+JSON.stringify({path,status:r.status,data:r.data})); assert.ok(r.data.error,'Structured error expected'); return r; }
const create = (entity,record) => good('/api/admin/records',{entity,record});
const read = (entity,key) => good('/api/admin/record?entity='+entity+'&key='+encodeURIComponent(key));
const update = (entity,key,record,revision) => good('/api/admin/records',{entity,key,record,revision},'PUT');
async function preview(entity, records) {
 const headers = [...new Set(records.flatMap(Object.keys))];
 const rows=records.map(row=>Object.fromEntries(headers.map(key=>[key,String(row[key]??'')])));
 return good('/api/admin/imports/preview',{entity,filename:'local-integration-fixtures.csv',rows,mapping:Object.fromEntries(headers.map(key=>[key,key]))});
}
const apply = id => good('/api/admin/imports/apply',{id});
const check = label => { passed++; console.log('PASS '+label); };

await good('/api/admin/bootstrap');
const productKey=prefix+'-P', sku=prefix+'-S', location=prefix+'-L';
const privateSentinel = prefix + '-PRIVATE-INTERNAL-NOTE';
const product={product_key:productKey,notes:privateSentinel,title:'TEST ONLY - local inventory fixture',brand:prefix+' fixture brand',manufacturer_part_number:'0000123',category:'tools',description:'Disposable local QA record. This is not business inventory.',base_unit_code:'each',fitment_mode:'non_vehicle_specific',source_name:'Local automated QA',source_reference:'tests/inventory-integration.mjs',publication_status:'published'};
let productRecord=(await create('products',product)).record;
assert.equal(productRecord.publication_status,'draft'); assert.equal(productRecord.manufacturer_part_number,'0000123');
check('product creation forces draft and preserves leading-zero part numbers');
assert.equal((await good('/api/catalog?sku='+sku)).products.length,0);
await bad('/api/admin/records',{entity:'products',record:{...product,product_key:prefix+'-DUP'}});
check('brand and manufacturer number duplicates are rejected');
await bad('/api/admin/records',{entity:'products',key:productKey,revision:productRecord.revision,record:{publication_status:'published'}},'PUT');
check('publication is blocked before its dependencies exist');
await bad('/api/admin/records',{entity:'skus',record:{internal_sku:prefix+'-BAD',product_key:prefix+'-MISSING',selling_unit:'each',base_units_per_selling_unit:1}});
await create('skus',{internal_sku:sku,product_key:productKey,selling_unit:'each',base_units_per_selling_unit:1,condition:'new',reorder_point:2});
await create('locations',{location_key:location,name:'TEST ONLY local QA store',type:'store'});
await create('suppliers',{supplier_key:prefix+'-SUP',company:'TEST ONLY supplier',notes:privateSentinel});
await create('offers',{offer_key:prefix+'-OFFER',supplier_key:prefix+'-SUP',internal_sku:sku,supplier_part_number:'0000456',unit_cost:'4.56',notes:privateSentinel});
check('referential integrity and linked product/SKU/location creation');
await bad('/api/admin/records',{entity:'prices',record:{price_key:prefix+'-PRICEBAD',internal_sku:sku,price_list:'retail',minimum_quantity:1,unit_price:'12.345',core_charge:0}});
await create('prices',{price_key:prefix+'-PRICE',internal_sku:sku,price_list:'retail',minimum_quantity:1,unit_price:'12.34',core_charge:'1.25'});
await bad('/api/admin/records',{entity:'prices',record:{price_key:prefix+'-OVERLAP',internal_sku:sku,price_list:'retail',minimum_quantity:1,unit_price:'13.34',core_charge:0}});
check('exact money precision and overlapping active price checks');
const opening={count_key:prefix+'-COUNT',internal_sku:sku,location_key:location,disposition:'sellable',quantity:5,reason:'TEST ONLY opening count'};
const openingPreview=await preview('opening_stock',[opening]); assert.equal(openingPreview.errorCount,0);
await apply(openingPreview.id); await apply(openingPreview.id);
let balance=(await good('/api/admin/stock?q='+encodeURIComponent(sku))).records[0]; assert.equal(balance.sellable,5);
const duplicateOpening=await preview('opening_stock',[{...opening,count_key:prefix+'-RECOUNT'}]); assert.ok(duplicateOpening.errorCount>0);
await bad('/api/admin/imports/apply',{id:duplicateOpening.id});
check('opening-stock imports apply once and cannot overwrite existing balances');
const stockBody={sku,location_key:location,disposition:'sellable',quantity:-4,reason:'TEST ONLY concurrent removal'};
const removals=await Promise.all([request('/api/admin/stock',{...stockBody,idempotency_key:prefix+'-R1'}),request('/api/admin/stock',{...stockBody,idempotency_key:prefix+'-R2'})]);
assert.equal(removals.filter(r=>r.ok).length,1); assert.equal(removals.filter(r=>!r.ok).length,1);
balance=(await good('/api/admin/stock?q='+encodeURIComponent(sku))).records[0]; assert.equal(balance.sellable,1);
const acceptedKey=removals[0].ok?prefix+'-R1':prefix+'-R2';
await good('/api/admin/stock',{...stockBody,idempotency_key:acceptedKey});
assert.equal((await good('/api/admin/stock?q='+encodeURIComponent(sku))).records[0].sellable,1);
await bad('/api/admin/stock',{...stockBody,quantity:1,idempotency_key:acceptedKey});
check('concurrent removals cannot cross zero and adjustment retries are idempotent');
let currentSku=(await read('skus',sku)).record;
await bad('/api/admin/records',{entity:'skus',key:sku,revision:currentSku.revision,record:{base_units_per_selling_unit:2}},'PUT');
await bad('/api/admin/records',{entity:'products',key:productKey,revision:productRecord.revision,record:{base_unit_code:'litre'}},'PUT');
check('stock history prevents silent package-unit reinterpretation');
const stale=productRecord.revision;
productRecord=(await update('products',productKey,{description:product.description+' Reviewed locally.'},stale)).record;
await bad('/api/admin/records',{entity:'products',key:productKey,revision:stale,record:{title:'Should not overwrite'}},'PUT');
check('stale record revisions cannot overwrite newer edits');
productRecord=(await update('products',productKey,{publication_status:'published'},productRecord.revision)).record;
const publicProduct=(await good('/api/catalog?sku='+sku)).products[0];
assert.equal(publicProduct.price,12.34); assert.equal(publicProduct.available_quantity,1);
assert.ok(!JSON.stringify(publicProduct).includes('unit_cost')); assert.ok(!JSON.stringify(publicProduct).includes(privateSentinel)); assert.ok(!JSON.stringify(publicProduct).includes('supplier_part_number')); assert.ok(!JSON.stringify(publicProduct).includes('source_reference')); 
check('reviewed products publish with retail price and local stock without private costs');
const importGood={...product,product_key:prefix+'-IMPORT',manufacturer_part_number:'0000999'}; delete importGood.publication_status;
const mixed=await preview('products',[importGood,{...importGood,product_key:prefix+'-BROKEN',manufacturer_part_number:'0000888',brand:''}]);
assert.ok(mixed.errorCount>0); await bad('/api/admin/imports/apply',{id:mixed.id}); await bad('/api/admin/record?entity=products&key='+importGood.product_key);
check('a batch with invalid rows applies no partial product records');
const staged=await preview('products',[importGood]); assert.equal(staged.errorCount,0); await apply(staged.id); await apply(staged.id);
assert.equal((await read('products',importGood.product_key)).record.publication_status,'draft');
const repeated=await preview('products',[importGood]); assert.ok(repeated.errorCount>0);
check('catalog imports stay draft and reject duplicate natural keys on a new batch');
const vehicleKey=prefix+'-V', fitmentKey=prefix+'-F';
await create('vehicles',{vehicle_key:vehicleKey,year:2000,make:'QA fictional make',model:'QA fictional model',market:'US',configuration_status:'partial'});
const vehicleProduct={...product,product_key:prefix+'-VP',manufacturer_part_number:'0000777',fitment_mode:'vehicle_specific'};
await create('products',vehicleProduct);
await bad('/api/admin/records',{entity:'fitments',record:{fitment_key:fitmentKey,product_key:vehicleProduct.product_key,vehicle_key:vehicleKey,review_status:'verified',restriction_status:'none',source_name:'TEST ONLY',source_reference:'Local fixture'}});
check('incomplete vehicle configurations cannot support verified fitment');

// One connected storefront fixture checks the actual eligible-row facets and
// carries their exact configuration key into the public catalog request.
const completeVehicle = {
  vehicle_key: prefix+'-COMPLETE-V', year:2097, make:prefix+' Fictional Make A', model:'Fixture Model A',
  engine:'Fixture engine A', trim:'Fixture trim', drivetrain:'Fixture FWD', transmission:'Fixture automatic',
  body:'Fixture hatchback', market:'US', configuration_status:'reviewed',
  source_name:'TEST ONLY vehicle evidence', source_reference:privateSentinel, notes:privateSentinel,
};
const alternateVehicle = {...completeVehicle,vehicle_key:prefix+'-ALT-V',year:2096,make:prefix+' Fictional Make B',model:'Fixture Model B',engine:'Fixture engine B'};
const restrictedVehicle = {...completeVehicle,vehicle_key:prefix+'-RESTRICTED-V',year:2094,make:prefix+' Restricted Make',model:'Fixture restricted model'};
for (const configuration of [completeVehicle,alternateVehicle,restrictedVehicle]) await create('vehicles',configuration);
const application = {product_key:vehicleProduct.product_key,review_status:'verified',restriction_status:'none',source_name:'TEST ONLY application evidence',source_reference:privateSentinel};
await create('fitments',{...application,fitment_key:prefix+'-COMPLETE-F',vehicle_key:completeVehicle.vehicle_key});
await create('fitments',{...application,fitment_key:prefix+'-ALT-F',vehicle_key:alternateVehicle.vehicle_key});
await create('fitments',{...application,fitment_key:prefix+'-RESTRICTED-F',vehicle_key:restrictedVehicle.vehicle_key,restriction_status:'resolved',restrictions:'Only with fixture equipment package; confirm this qualifier manually.'});
await create('fitments',{...application,fitment_key:prefix+'-PARTIAL-F',vehicle_key:vehicleKey,review_status:'draft',restriction_status:'unresolved'});
const vehicleSku=prefix+'-VS';
await create('skus',{internal_sku:vehicleSku,product_key:vehicleProduct.product_key,selling_unit:'each',base_units_per_selling_unit:1});
const vehicleProductRevision=(await read('products',vehicleProduct.product_key)).record.revision;
await update('products',vehicleProduct.product_key,{publication_status:'published'},vehicleProductRevision);
const facet = (query) => good('/api/catalog/vehicles?'+new URLSearchParams(query));
const years=await facet({field:'years'});
assert.ok(years.values.includes(String(completeVehicle.year))); assert.ok(years.values.includes(String(alternateVehicle.year)));
const makes=await facet({field:'makes',year:String(completeVehicle.year)});
assert.ok(makes.values.includes(completeVehicle.make)); assert.ok(!makes.values.includes(alternateVehicle.make));
const models=await facet({field:'models',year:String(completeVehicle.year),make:completeVehicle.make});
assert.deepEqual(models.values,[completeVehicle.model]);
const configurations=await facet({field:'configurations',year:String(completeVehicle.year),make:completeVehicle.make,model:completeVehicle.model});
assert.deepEqual(configurations.vehicles.map(v=>v.vehicle_key),[completeVehicle.vehicle_key]);
assert.equal(configurations.vehicles[0].engine,completeVehicle.engine);
assert.equal(configurations.vehicles[0].body,completeVehicle.body);
assert.ok(!JSON.stringify(configurations).includes(privateSentinel));
assert.ok(!JSON.stringify(configurations).includes('source_reference'));
const inventedCombination=await facet({field:'configurations',year:String(completeVehicle.year),make:completeVehicle.make,model:alternateVehicle.model});
assert.equal(inventedCombination.vehicles.length,0);
const restrictedOptions=await facet({field:'configurations',year:String(restrictedVehicle.year),make:restrictedVehicle.make,model:restrictedVehicle.model});
assert.equal(restrictedOptions.vehicles.length,0,'Restricted applications must not become confirmed vehicle-picker options.');
const partialOptions=await facet({field:'configurations',year:'2000',make:'QA fictional make',model:'QA fictional model'});
assert.ok(!partialOptions.vehicles.some(v=>v.vehicle_key===vehicleKey));
const matchingProduct=(await good('/api/catalog?'+new URLSearchParams({sku:vehicleSku,vehicle_key:configurations.vehicles[0].vehicle_key}))).products[0];
assert.equal(matchingProduct.sku,vehicleSku);
assert.equal(matchingProduct.fitments.find(f=>f.vehicle_key===completeVehicle.vehicle_key).verification_state,'source_verified');
assert.equal(matchingProduct.fitments.find(f=>f.vehicle_key===restrictedVehicle.vehicle_key).verification_state,'manual_confirmation');
assert.ok(!matchingProduct.fitments.some(f=>f.vehicle_key===vehicleKey));
assert.equal((await good('/api/catalog?'+new URLSearchParams({sku:vehicleSku,vehicle_key:vehicleKey}))).products.length,0);
check('reviewed vehicle facets select real catalog fits and exclude incomplete or restricted confirmation');

// Store selection changes stock context, never the shared SKU or catalog.
const multiProduct=prefix+'-MULTI-P',multiSku=prefix+'-MULTI-S';
let multiRecord=(await create('products',{...product,product_key:multiProduct,manufacturer_part_number:'0000666'})).record;
await create('skus',{internal_sku:multiSku,product_key:multiProduct,selling_unit:'each',base_units_per_selling_unit:1,reorder_point:2});
multiRecord=(await update('products',multiProduct,{publication_status:'published'},multiRecord.revision)).record;
const storeA=prefix+'-COUDERSPORT',storeB=prefix+'-PORT-ALLEGANY',storeC=prefix+'-SMETHPORT',storeUnknown=prefix+'-UNCOUNTED',warehouse=prefix+'-WAREHOUSE',archivedStore=prefix+'-ARCHIVED';
for (const [key,name,type] of [[storeA,'Coudersport','store'],[storeB,'Port Allegany','store'],[storeC,'Smethport','store'],[storeUnknown,'Uncounted fixture store','store'],[warehouse,'Private fixture warehouse','warehouse'],[archivedStore,'Archived fixture store','store']]) {
  await create('locations',{location_key:key,name,type,city:name,state:'PA',notes:privateSentinel});
}
for (const [key,quantity] of [[storeA,3],[storeB,0],[storeC,5],[warehouse,40],[archivedStore,90]]) {
  const stagedCount=await preview('opening_stock',[{count_key:key+'-COUNT',internal_sku:multiSku,location_key:key,disposition:'sellable',quantity,reason:'TEST ONLY per-store opening'}]);
  assert.equal(stagedCount.errorCount,0);await apply(stagedCount.id);
}
const archivedRecord=(await read('locations',archivedStore)).record;
await update('locations',archivedStore,{status:'archived'},archivedRecord.revision);
const directory=await good('/api/locations');
assert.ok(directory.locations.some(row=>row.location_key===storeA&&row.city==='Coudersport'&&row.state==='PA'));
assert.ok(!directory.locations.some(row=>[warehouse,archivedStore].includes(row.location_key)));
assert.ok(!JSON.stringify(directory).includes(privateSentinel));assert.ok(!JSON.stringify(directory).includes('notes'));
const allStoreProduct=(await good('/api/catalog?sku='+multiSku)).products[0];
assert.equal(allStoreProduct.available_quantity,8,'Only recorded active-store sellable balances form the all-store quantity.');
const availability=Object.fromEntries(allStoreProduct.availability_by_location.map(row=>[row.location_key,row.available_quantity]));
assert.equal(availability[storeA],3);assert.equal(availability[storeB],0);assert.equal(availability[storeC],5);assert.equal(availability[storeUnknown],null);
assert.equal(availability[warehouse],undefined);assert.equal(availability[archivedStore],undefined);
for (const [key,expected] of [[storeA,3],[storeB,0],[storeC,5],[storeUnknown,null]]) {
  const selected=await good('/api/catalog?'+new URLSearchParams({sku:multiSku,location_key:key}));
  assert.equal(selected.selectedLocationKey,key);assert.equal(selected.products.length,1,'A zero or unknown count does not remove a catalog product.');
  assert.equal(selected.products[0].available_quantity,expected);
}
await bad('/api/catalog?location_key='+warehouse);await bad('/api/catalog?location_key='+archivedStore);await bad('/api/catalog?location_key='+prefix+'-MISSINGSTORE');
const filteredStock=await good('/api/admin/stock?'+new URLSearchParams({q:multiSku,location_key:storeB}));
assert.equal(filteredStock.total,1);assert.equal(filteredStock.records[0].location_key,storeB);assert.equal(filteredStock.records[0].available_quantity,0);
assert.equal(filteredStock.summary.positions,1);assert.equal(filteredStock.summary.inStock,0);assert.equal(filteredStock.summary.atOrBelowReorder,1);
assert.ok(filteredStock.locations.some(row=>row.location_key===warehouse),'Staff stock filter can include internal nonstore locations.');
assert.equal((await good('/api/admin/stock?'+new URLSearchParams({q:multiSku,location_key:storeUnknown}))).total,0);
check('store-specific quantities, unknown versus zero, private location boundaries and filtered stock summaries');

const before=(await good('/api/admin/bootstrap')).counts.products;
const crossOrigin=await testFetch(origin+'/api/admin/records',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://unrelated.example'},body:JSON.stringify({entity:'products',record:{...product,product_key:prefix+'-CSRF',manufacturer_part_number:'CSRF'}})});
assert.equal(crossOrigin.status,403); assert.equal((await good('/api/admin/bootstrap')).counts.products,before);
check('cross-origin writes are rejected');
const summary = {passed,prefix,environment,note:'Actual inventory route code and the shipped libSQL adapter used a disposable local file. Better Auth session behavior is covered by the separate auth suite; hosted Turso and browser behavior are not asserted.'};
console.log(JSON.stringify(summary));
return summary;
}

