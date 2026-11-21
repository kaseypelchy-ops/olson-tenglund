/* Olson & Tenglund storefront.
 * Catalog records come from approved inventory records. No orders are transmitted.
 * Only the preferred store, selected vehicle, and shopping cart are saved in this browser.
 */
(() => {
  'use strict';

  let products = [];
  let vehicles = [];
  let stores = [];
  let storeSelectionSequence = 0;
  let storeChanging = false;
  let vehicleYears = null;
  let vehicleModels = [];
  let vehicleConfigs = [];
  let vehicleLookupMessage = '';
  let vehicleLookupSequence = 0;
  let catalogRequest = 0;
  let catalogTotal = 0;
  let catalogHasMore = false;
  let catalogPage = 1;
  let catalogError = '';
  let catalogLoading = true;
  const categoryNames = {
    all: 'All parts', brakes: 'Brakes & rotors', batteries: 'Batteries & starting',
    filters: 'Filters', oil: 'Oil & fluids', wipers: 'Wipers & visibility', ignition: 'Ignition'
  };
  const STORE_KEY = 'olson-tenglund.catalog.v2';
  const GARAGE_KEY = 'olson-tenglund.garage.v1';
  function readGarage() {
    try {
      const saved = JSON.parse(localStorage.getItem(GARAGE_KEY) || 'null');
      return { version: 1, vehicles: Array.isArray(saved?.vehicles) ? saved.vehicles : [], activeKey: saved?.activeKey || null };
    } catch (_) { return { version: 1, vehicles: [], activeKey: null }; }
  }
  function garageKey(vehicle) { return `${vehicle.reference_key}:${vehicle.epa_id ?? 'reference'}`; }
  function garageActiveVehicle() {
    const garage = readGarage();
    return garage.vehicles.find(v => garageKey(v) === garage.activeKey || (v.epa_id == null && v.reference_key === garage.activeKey)) || null;
  }
  function garageSaveVehicle(vehicle) {
    const garage = readGarage();
    const key = garageKey(vehicle);
    if (!garage.vehicles.some(v => garageKey(v) === key)) {
      if (garage.vehicles.length >= 20) throw new Error('My Garage supports up to 20 vehicles. Remove one in Manage My Garage first.');
      garage.vehicles.push(vehicle);
    }
    garage.activeKey = key;
    localStorage.setItem(GARAGE_KEY, JSON.stringify(garage));
  }
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const byId = new Map(products.map((p) => [p.id, p]));
  const $ = (id) => document.getElementById(id);
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const price = (cents) => cents == null ? 'Call for price' : money.format(cents / 100);
  const getProduct = (id) => byId.get(id) || [...byId.values()].find(p => p.id.toLowerCase() === String(id).toLowerCase());
  const state = { cart: [], vehicle: null, locationKey: '', query: '', category: 'all', sort: 'recommended', showAll: false };
  let toastTimer;
  let accountDraft = '';
  let persistenceAvailable = true;
  const dialogOpeners = new WeakMap();

  async function lookupSku(id) {
    const cached = getProduct(id);
    if (cached && cached.location_context === state.locationKey) return cached;
    const sequence = storeSelectionSequence;
    const params = new URLSearchParams({sku: id, pageSize: '1'});
    if (state.locationKey) params.set('location_key', state.locationKey);
    const response = await fetch('/api/catalog?' + params);
    if (!response.ok) throw new Error('Catalog lookup unavailable.');
    const payload = await response.json();
    if (sequence !== storeSelectionSequence) throw new Error('Store preference changed. Please try again.');
    const item = (payload.products || []).find(p => String(p.id || p.sku).toLowerCase() === String(id).toLowerCase());
    if (!item) return null;
    const product = normalizeProduct(item);
    byId.set(product.id, product);
    return product;
  }

  async function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      state.locationKey = stores.some(store => store.location_key === saved.locationKey) ? saved.locationKey : '';
      renderStorePreference();
      const lines = Array.isArray(saved.cart) ? saved.cart.slice(0, 100) : [];
      const restored = [];
      for (let start = 0; start < lines.length; start += 5) {
        const batch = await Promise.allSettled(lines.slice(start, start + 5).map(async line => {
          if (!line || typeof line.id !== 'string' || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) return null;
          const product = await lookupSku(line.id);
          return product ? {id: product.id, quantity: line.quantity} : null;
        }));
        batch.forEach(result => { if (result.status === 'fulfilled' && result.value) restored.push(result.value); });
      }
      const unique = new Map();
      restored.forEach(line => unique.set(line.id, Math.min(99, (unique.get(line.id) || 0) + line.quantity)));
      state.cart = [...unique].map(([id,quantity]) => ({id,quantity}));
      // The public garage uses EPA reference IDs, not verified catalog vehicle keys.
      state.vehicle = null;
      if (lines.length && restored.length < lines.length) toast('Some saved parts could not be verified in the current catalog. Please review your list.');
    } catch (_) { persistenceAvailable = false; }
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ cart: state.cart, vehicle: state.vehicle, locationKey: state.locationKey }));
      persistenceAvailable = true;
    } catch (_) {
      persistenceAvailable = false;
    }
  }

  function toast(message) {
    const box = $('toast');
    const content = $('toast-message');
    if (!box) return;
    if (content) content.textContent = message;
    else box.textContent = message;
    clearTimeout(toastTimer);
    box.classList.add('is-visible');
    box.hidden = false;
    toastTimer = setTimeout(() => box.classList.remove('is-visible'), 4500);
  }

  function scrollToSection(id) {
    const target = $(id);
    if (!target) return;
    target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function closeMenus() {
    ['mobile', 'category'].forEach((prefix) => {
      const menu = $(prefix + '-menu');
      const toggle = $(prefix === 'mobile' ? 'mobile-menu-toggle' : 'category-toggle');
      if (menu) { menu.hidden = true; menu.classList.remove('is-open'); }
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    });
  }

  function toggleMenu(prefix) {
    const menu = $(prefix + '-menu');
    const toggle = $(prefix === 'mobile' ? 'mobile-menu-toggle' : 'category-toggle');
    if (!menu || !toggle) return;
    const opening = toggle.getAttribute('aria-expanded') !== 'true';
    closeMenus();
    menu.hidden = !opening;
    menu.classList.toggle('is-open', opening);
    toggle.setAttribute('aria-expanded', String(opening));
  }

  function openDialog(id) {
    const dialog = $(id);
    if (!dialog) return;
    closeMenus();
    const opener = document.activeElement;
    document.querySelectorAll('dialog[open]').forEach((other) => {
      if (other !== dialog) other.close();
    });
    dialogOpeners.set(dialog, opener);
    if (!dialog.open) dialog.showModal();
  }

  function closeDialog(dialog) {
    if (dialog && dialog.open) dialog.close();
  }

  function selectedStore() { return stores.find(store => store.location_key === state.locationKey) || null; }
  function storeName(store) { return store.city || store.name || store.location_key; }
  function storePreferenceText() { const store = selectedStore(); return store ? storeName(store) + (store.state ? ', ' + store.state : '') : 'Not selected'; }

  function renderStorePreference() {
    const select = $('preferred-store');
    if (select) { select.value = state.locationKey; select.disabled = !stores.length; }
    document.querySelectorAll('[data-select-store]').forEach(button => {
      const selected = button.dataset.selectStore === state.locationKey;
      const available = stores.some(store => store.location_key === button.dataset.selectStore);
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = selected ? 'Your selected store' : 'Make this my store';
      button.disabled = !available;
      button.classList.toggle('button-navy', selected);
      button.classList.toggle('button-outline', !selected);
      button.closest('.location-card')?.classList.toggle('is-selected', selected);
    });
    const store = selectedStore();
    const context = $('store-availability-context')?.querySelector('span');
    if (context) context.textContent = storeChanging ? 'Refreshing availability for ' + storePreferenceText() + '…' : store ? 'Recorded availability at ' + storePreferenceText() + '. Confirm fulfillment with the store.' : 'Availability across stores. Choose your store for a location-specific view.';
    if ($('cart-store-preference')) $('cart-store-preference').textContent = 'Store preference: ' + storePreferenceText() + ' · No reservation';
  }

  function renderStoreCards() {
    const grid = $('store-grid');
    if (!grid) return;
    if (!stores.length) { grid.innerHTML = '<p class="location-details-pending">Store contact details are being updated. Please check again soon.</p>'; return; }
    grid.innerHTML = stores.map(store => {
      const locality = [store.city || store.name, store.state].filter(Boolean).join(', ') + (store.postal_code ? ' ' + store.postal_code : '');
      const address = [store.address_line1, store.address_line2, locality].filter(Boolean);
      const digits = String(store.phone || '').replace(/[^0-9+]/g, '');
      const telephone = digits && /^\+?\d{7,15}$/.test(digits) ? '<a href="tel:' + escapeHTML(digits) + '">' + escapeHTML(store.phone) + '</a>' : '';
      const hours = store.store_hours ? '<p class="location-hours">' + escapeHTML(store.store_hours) + '</p>' : telephone ? '<p class="location-hours">Contact the store for current hours.</p>' : '';
      const directions = store.address_line1 ? '<a class="text-link location-directions" href="https://www.google.com/maps/search/?api=1&amp;query=' + encodeURIComponent('Olson & Tenglund ' + address.join(' ')) + '" target="_blank" rel="noopener noreferrer">Get directions</a>' : '';
      const pending = !store.address_line1 && !telephone ? '<p class="location-details-pending">Store contact details coming soon.</p>' : '';
      return '<article class="store-card location-card" data-store-card="' + escapeHTML(store.location_key) + '"><div class="location-card-heading"><svg class="icon"><use href="#i-store"/></svg><div><span class="eyebrow">' + escapeHTML(store.state === 'PA' ? 'PENNSYLVANIA' : store.state || 'YOUR LOCAL STORE') + '</span><h3>' + escapeHTML(storeName(store)) + '</h3></div></div><div class="location-card-details"><p>' + address.map(escapeHTML).join('<br>') + '</p>' + telephone + hours + pending + '</div>' + directions + '<button class="button button-outline full-width" type="button" data-select-store="' + escapeHTML(store.location_key) + '" aria-pressed="false">Make this my store</button></article>';
    }).join('');
  }

  async function loadStores() {
    try {
      const response = await fetch('/api/locations');
      if (!response.ok) throw new Error('Store details are unavailable.');
      const payload = await response.json();
      stores = Array.isArray(payload.locations) ? payload.locations : [];
      $('preferred-store').innerHTML = '<option value="">All locations</option>' + stores.map(store => '<option value="' + escapeHTML(store.location_key) + '">' + escapeHTML(storeName(store)) + '</option>').join('');
      renderStoreCards();
    } catch (_) { stores = []; }
    renderStorePreference();
  }

  function availabilityText(product) {
    const store = selectedStore();
    if (product.location_context !== state.locationKey) return 'Confirm availability' + (store ? ' at ' + storeName(store) : ' with your store');
    const amount = product.available_quantity;
    if (amount === null || amount === undefined) return 'Confirm availability' + (store ? ' at ' + storeName(store) : ' with your store');
    if (Number(amount) === 0) return 'No recorded stock' + (store ? ' at ' + storeName(store) : ' across stores');
    return String(amount) + ' recorded' + (store ? ' at ' + storeName(store) : ' across stores');
  }

  function storeAvailabilityDetails(product) {
    const entries = Array.isArray(product.availability_by_location) ? product.availability_by_location : [];
    if (!entries.length) return '<div class="store-stock-details"><h3>Store availability</h3><p>Confirm availability with your local parts counter.</p></div>';
    return '<div class="store-stock-details"><h3>Store availability</h3><dl>' + entries.map(entry => '<div' + (entry.location_key === state.locationKey ? ' class="is-selected"' : '') + '><dt>' + escapeHTML(entry.name) + (entry.location_key === state.locationKey ? '<small>Your store</small>' : '') + '</dt><dd>' + escapeHTML(entry.available_quantity == null ? 'Confirm availability' : Number(entry.available_quantity) === 0 ? 'No recorded stock' : entry.available_quantity + ' recorded') + '</dd></div>').join('') + '</dl><p>Recorded selling units. Confirm current availability before visiting.</p></div>';
  }

  async function changeStore(key) {
    if (key && !stores.some(store => store.location_key === key)) return;
    if (key === state.locationKey) return;
    state.locationKey = key;
    const sequence = ++storeSelectionSequence;
    storeChanging = true;
    const previous = [...byId.values()];
    byId.clear();
    // Retain names for existing list lines while invalidating all cached availability and prices.
    previous.forEach(product => byId.set(product.id, {...product, price: null, available_quantity: null, availability_by_location: [], location_context: null}));
    persist();
    renderStorePreference();
    renderCart();
    const catalog = renderProducts();
    let refreshFailed = false;
    for (let start = 0; start < state.cart.length; start += 5) {
      const results = await Promise.allSettled(state.cart.slice(start, start + 5).map(line => lookupSku(line.id)));
      if (results.some(result => result.status === 'rejected' || !result.value)) refreshFailed = true;
      if (sequence !== storeSelectionSequence) return;
    }
    await catalog;
    if (sequence !== storeSelectionSequence) return;
    storeChanging = false;
    renderStorePreference();
    renderCart();
    if ($('order-dialog')?.open) renderOrder();
    toast(refreshFailed ? 'Store preference saved. Some list details need confirmation with the store.' : selectedStore() ? storePreferenceText() + ' selected. No parts have been reserved.' : 'Showing availability across stores.');
  }

  function vehicleText() {
    return state.vehicle ? [state.vehicle.year, state.vehicle.make, state.vehicle.model, state.vehicle.engine].filter(Boolean).join(' ') : 'No vehicle selected';
  }

  function optionList(values, prompt) {
    return '<option value="">' + escapeHTML(prompt) + '</option>' + [...new Set(values)].map(value => '<option value="' + escapeHTML(value) + '">' + escapeHTML(value) + '</option>').join('');
  }

  async function directoryLookup(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Vehicle selection is unavailable. Please try again or contact the parts counter.');
    return response.json();
  }
  function clearVehicleSelect(id, prompt) {
    const input = $(id); input.innerHTML = optionList([], prompt); input.disabled = true;
  }
  function disableVehicleSubmit() { $('vehicle-form').querySelector('button[type=submit]').disabled = true; }
  function vehicleEngineLabel(c) {
    return [c.engine_displacement_l != null ? `${c.engine_displacement_l}L` : '',
      c.cylinders != null ? `${c.cylinders} cylinders` : '', c.engine_description || '',
      c.electric_motor || '', c.fuel_type_primary || c.fuel_type || ''].filter(Boolean).join(' · ') || 'Engine not listed';
  }
  function vehicleDriveLabel(c) { return c.drive?.trim() || 'Drivetrain not listed'; }
  function vehicleTransmissionLabel(c) {
    return [c.transmission || c.transmission_description || 'Transmission not listed',
      ...(c.transmission && c.transmission_description && c.transmission !== c.transmission_description ? [c.transmission_description] : [])].join(' · ');
  }
  async function fillVehicleMakes() {
    const sequence = ++vehicleLookupSequence;
    vehicleModels = []; vehicleConfigs = [];
    clearVehicleSelect('vehicle-make', 'Select make');
    clearVehicleSelect('vehicle-model', 'Select model');
    clearVehicleSelect('vehicle-configuration', 'Select configuration');
    disableVehicleSubmit();
    const year = $('vehicle-year').value;
    if (!year) return;
    try {
      const result = await directoryLookup('/api/vehicle-directory?year=' + encodeURIComponent(year));
      if (sequence !== vehicleLookupSequence) return;
      $('vehicle-make').innerHTML = optionList(result.makes || [], 'Select make');
      $('vehicle-make').disabled = !(result.makes || []).length;
      vehicleLookupMessage = ''; renderVehicle();
    } catch (error) { if (sequence === vehicleLookupSequence) { vehicleLookupMessage = error.message; renderVehicle(); } }
  }
  async function fillVehicleModels() {
    const sequence = ++vehicleLookupSequence;
    vehicleModels = []; vehicleConfigs = [];
    clearVehicleSelect('vehicle-model', 'Select model');
    clearVehicleSelect('vehicle-configuration', 'Select configuration');
    disableVehicleSubmit();
    const year = $('vehicle-year').value, make = $('vehicle-make').value;
    if (!year || !make) return;
    try {
      const result = await directoryLookup('/api/vehicle-directory/options?' + new URLSearchParams({year,make}));
      if (sequence !== vehicleLookupSequence) return;
      vehicleModels = result.models || [];
      $('vehicle-model').innerHTML = '<option value="">Select model</option>' + vehicleModels.map(v =>
        '<option value="' + escapeHTML(v.reference_key) + '">' + escapeHTML(v.display_model + (v.configuration_hint ? ' · ' + v.configuration_hint : '')) + '</option>').join('');
      $('vehicle-model').disabled = !vehicleModels.length;
      vehicleLookupMessage = ''; renderVehicle();
    } catch (error) { if (sequence === vehicleLookupSequence) { vehicleLookupMessage = error.message; renderVehicle(); } }
  }
  async function fillVehicleConfigurations() {
    const sequence = ++vehicleLookupSequence;
    vehicleConfigs = [];
    clearVehicleSelect('vehicle-configuration', 'Select configuration');
    disableVehicleSubmit();
    const referenceKey = $('vehicle-model').value;
    if (!referenceKey) return;
    vehicleLookupMessage = 'Loading available vehicle configurations…'; renderVehicle();
    try {
      const result = await directoryLookup('/api/vehicle-directory/configurations?referenceKey=' + encodeURIComponent(referenceKey));
      if (sequence !== vehicleLookupSequence) return;
      vehicleConfigs = result.configurations || [];
      const select = $('vehicle-configuration');
      select.innerHTML = '<option value="">' + (vehicleConfigs.length ? 'Select engine / drivetrain / transmission' : 'No detailed EPA configuration') + '</option>' +
        vehicleConfigs.map(c => '<option value="' + escapeHTML(c.epa_id) + '">' +
          escapeHTML([vehicleEngineLabel(c), vehicleDriveLabel(c), vehicleTransmissionLabel(c)].join(' · ')) + '</option>').join('');
      select.disabled = !vehicleConfigs.length;
      select.required = vehicleConfigs.length > 0;
      $('vehicle-form').querySelector('button[type=submit]').disabled = false;
      vehicleLookupMessage = vehicleConfigs.length
        ? 'Choose the exact configuration, then save it to My Garage. Parts fitment is not yet verified.'
        : 'You can save this year, make and model. Detailed configuration data is unavailable; parts fitment is not verified.';
      renderVehicle();
    } catch (error) { if (sequence === vehicleLookupSequence) { vehicleLookupMessage = error.message; renderVehicle(); } }
  }
  function renderVehicle() {
    const garageVehicle = garageActiveVehicle();
    $('vehicle-label').textContent = garageVehicle
      ? [garageVehicle.year, garageVehicle.make, garageVehicle.display_model, garageVehicle.configuration_label].filter(Boolean).join(' · ')
      : 'My Garage · Add a vehicle';
    $('selected-vehicle-status').textContent = vehicleLookupMessage ||
      (garageVehicle ? `Saved: ${garageVehicle.year} ${garageVehicle.make} ${garageVehicle.display_model}${garageVehicle.configuration_label ? ' · ' + garageVehicle.configuration_label : ''}. Browse parts; compatibility must be confirmed separately.`
        : vehicleYears?.length ? 'Select your vehicle to save it to My Garage. Parts compatibility is not yet verified.'
          : 'Vehicle directory is unavailable. Call us for help finding a part.');
    // Saved vehicles are managed on the dedicated My Garage page.
  }
  async function configureVehicle() {
    try {
      const result = await directoryLookup('/api/vehicle-directory');
      vehicleYears = (result.years || []).map(String);
      $('vehicle-year').innerHTML = optionList(vehicleYears, 'Select year');
      $('vehicle-year').disabled = !vehicleYears.length;
      vehicleLookupMessage = vehicleYears.length ? '' : 'No vehicles loaded in the reference directory.';
    } catch (error) { vehicleLookupMessage = error.message; }
    renderVehicle();
  }

  function normalizeProduct(p) {
    const category = p.category || 'other';
    if (!categoryNames[category]) categoryNames[category] = category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, ' ');
    return {...p, location_context: state.locationKey, id: String(p.id || p.sku), category, name: p.name || p.title, label: p.brand || categoryNames[category], price: p.price == null ? null : Math.round(Number(p.price)*100), detail: p.description || '', specs: (p.attributes || []).map(a => [a.name, ': ', a.value, a.unit ? ' '+a.unit : ''].join('')), fitments: p.fitments || []};
  }

  function productImage(p) {
    if (p.image_url && /^https:\/\//i.test(p.image_url)) return '<img src="' + escapeHTML(p.image_url) + '" alt="' + escapeHTML(p.name) + '" loading="lazy" referrerpolicy="no-referrer">';
    return '<span class="image-pending"><svg class="icon"><use href="#i-box"/></svg><small>Image coming soon</small></span>';
  }

  function fitmentText(p) {
    if (p.fitment_mode === 'non_vehicle_specific') return 'General-purpose item';
    if (p.fitment_mode === 'specification_based') return 'Check required specifications';
    if (state.vehicle && p.fitments.some(f => f.vehicle_key === state.vehicle.vehicle_key)) return 'Vehicle application listed · review details';
    return 'Confirm the correct application';
  }

  function drawProducts() {
    const grid = $('product-grid');
    if (!grid) return;
    grid.setAttribute('aria-busy', String(catalogLoading));
    grid.innerHTML = products.length ? products.map(p => '<article class="product-card"><button class="product-image" type="button" data-product="' + escapeHTML(p.id) + '" aria-label="View ' + escapeHTML(p.name) + '">' + productImage(p) + '</button><div class="product-body"><p class="product-kicker">' + escapeHTML(p.label) + '</p><h3><button type="button" data-product="' + escapeHTML(p.id) + '">' + escapeHTML(p.name) + '</button></h3><p class="product-meta">Part # ' + escapeHTML(p.manufacturer_part_number || p.id) + '</p><p class="product-fitment">' + escapeHTML(fitmentText(p)) + '</p><div class="product-bottom"><span class="product-price">' + price(p.price) + '<small>' + escapeHTML(availabilityText(p)) + '</small></span><button class="add-button" type="button" data-add="' + escapeHTML(p.id) + '" aria-label="Add ' + escapeHTML(p.name) + ' to list"><span aria-hidden="true">+</span> Add</button></div></div></article>').join('') : '<div class="catalog-empty"><svg class="icon"><use href="#i-box"/></svg><h3>' + (catalogLoading ? 'Loading the catalog…' : catalogError ? 'The catalog could not be loaded' : state.query || state.category !== 'all' || state.vehicle ? 'No matching parts listed yet' : 'Our online catalog is taking shape.') + '</h3><p>' + (catalogError ? escapeHTML(catalogError) : 'Need a part now? Find your local parts counter in Coudersport, Port Allegany, or Smethport.') + '</p><a class="button button-navy" href="#our-stores">Find your store</a>' + ((state.query || state.category !== 'all' || state.vehicle) ? '<button class="text-button" type="button" data-reset-filters>Clear filters</button>' : '') + '</div>';
    $('catalog-count').textContent = catalogLoading ? 'Loading parts…' : 'Showing ' + products.length + ' of ' + catalogTotal + ' listed parts';
    $('show-all-products').hidden = !catalogHasMore;
    $('show-all-products').textContent = catalogLoading ? 'Loading…' : 'Load more parts';
    $('show-all-products').disabled = catalogLoading;
    if ($('catalog-query')) $('catalog-query').textContent = state.query ? 'Results for “'+state.query+'”' : '';
    $('catalog-category').value = state.category;
    $('catalog-sort').value = state.sort;
    $('reset-filters').hidden = !(state.query || state.category !== 'all' || state.vehicle);
    document.querySelectorAll('[data-category]').forEach(button => button.classList.toggle('is-active', button.dataset.category === state.category));
  }

  async function renderProducts(append = false) {
    const request = ++catalogRequest;
    const page = append ? catalogPage + 1 : 1;
    catalogLoading = true;
    catalogError = '';
    if (!append) products = [];
    drawProducts();
    try {
      const params = new URLSearchParams({q: state.query,category: state.category,sort: state.sort,page: String(page),pageSize:'24'});
      if (state.vehicle) params.set('vehicle_key', state.vehicle.vehicle_key);
      if (state.locationKey) params.set('location_key', state.locationKey);
      const response = await fetch('/api/catalog?' + params.toString());
      if (!response.ok) throw new Error('Please try again, or call the store for assistance.');
      const payload = await response.json();
      if (request !== catalogRequest) return;
      const loaded = (payload.products || []).map(normalizeProduct);
      loaded.forEach(p => byId.set(p.id,p));
      products = append ? [...products,...loaded] : loaded;
      catalogTotal = Number(payload.total || 0);
      catalogHasMore = Boolean(payload.hasMore);
      catalogPage = page;
      (payload.categories || []).forEach(category => { if (!categoryNames[category]) categoryNames[category] = category.charAt(0).toUpperCase()+category.slice(1).replace(/_/g,' '); });
      $('catalog-category').innerHTML = Object.entries(categoryNames).map(([key,name])=>'<option value="'+escapeHTML(key)+'">'+escapeHTML(name)+'</option>').join('');
      renderVehicle();
    } catch (error) { if (request !== catalogRequest) return; catalogError = error.message; catalogHasMore = false; catalogTotal = products.length; }
    finally { if (request === catalogRequest) { catalogLoading = false; drawProducts(); } }
  }

  function resetFilters() {
    state.query = '';
    state.category = 'all';
    state.sort = 'recommended';
    state.vehicle = null;
    persist();
    configureVehicle();
    state.showAll = true;
    if ($('site-search')) $('site-search').value = '';
    renderProducts();
  }

  function openProduct(id) {
    const p = getProduct(id);
    if (!p) return;
    const applications = p.fitments.filter(f => !state.vehicle || f.vehicle_key === state.vehicle.vehicle_key);
    $('product-dialog-content').innerHTML = '<button class="dialog-close" type="button" data-close-dialog aria-label="Close product details">×</button><div class="product-detail-grid"><div class="product-detail-image">'+productImage(p)+'</div><div class="product-detail-copy"><p class="eyebrow">'+escapeHTML(p.label)+'</p><h2 id="product-dialog-title">'+escapeHTML(p.name)+'</h2><p class="product-meta">Manufacturer part # '+escapeHTML(p.manufacturer_part_number || p.id)+' · SKU '+escapeHTML(p.id)+'</p><p class="detail-description">'+escapeHTML(p.detail)+'</p><p class="detail-price">'+price(p.price)+'</p>'+(p.core_charge ? '<p>Core charge: '+money.format(p.core_charge)+' per selling unit.</p>':'')+storeAvailabilityDetails(p)+'<div class="fitment-notice"><strong>'+escapeHTML(fitmentText(p))+'</strong><p>'+escapeHTML(vehicleText())+'</p></div><ul class="product-specs">'+p.specs.map(spec=>'<li>'+escapeHTML(spec)+'</li>').join('')+applications.map(f=>'<li>'+escapeHTML([f.position,f.restrictions].filter(Boolean).join(' · ') || 'Source-reviewed vehicle application')+'</li>').join('')+'</ul><form id="product-add-form" data-product-id="'+escapeHTML(p.id)+'" class="product-add-form"><label for="product-quantity">Quantity<input type="number" id="product-quantity" name="quantity" value="1" min="1" max="99" step="1" inputmode="numeric" required></label><button type="submit" class="button button-gold">Add to list</button></form><p class="small-note">Your list does not reserve stock or place an order. Confirm installation details with the parts counter.</p></div></div>';
    $('product-dialog').setAttribute('aria-labelledby','product-dialog-title');
    openDialog('product-dialog');
  }

  function subtotal() {
    return state.cart.reduce((sum, line) => sum + (getProduct(line.id)?.price || 0) * line.quantity, 0);
  }

  function renderCart() {
    renderStorePreference();
    const count = state.cart.reduce((sum, line) => sum + line.quantity, 0);
    if ($('cart-count')) {
      $('cart-count').textContent = String(count);
      $('cart-count').setAttribute('aria-label', count + (count === 1 ? ' item' : ' items') + ' in cart');
    }
    if ($('cart-open')) $('cart-open').setAttribute('aria-label', 'Open cart, ' + count + (count === 1 ? ' item' : ' items'));
    if ($('cart-items')) $('cart-items').innerHTML = state.cart.map((line) => {
      const p = getProduct(line.id);
      if (!p) return '<article class="cart-item"><p>SKU ' + escapeHTML(line.id) + ' · Qty ' + line.quantity + ' · Catalog details unavailable</p><button class="remove-item" type="button" data-remove="' + escapeHTML(line.id) + '">Remove</button></article>';
      return '<article class="cart-item">' +
        '<div class="cart-item-image">' + productImage(p) + '</div>' +
        '<div class="cart-item-content"><h3>' + escapeHTML(p.name) + '</h3><p class="product-meta">' + escapeHTML(p.id) + '</p><p class="cart-stock-note">' + escapeHTML(availabilityText(p)) + '</p>' +
          '<div class="quantity-control"><button type="button" data-cart-step="' + escapeHTML(p.id) + '" data-step="-1" aria-label="Decrease quantity of ' + escapeHTML(p.name) + '">−</button>' +
          '<input type="number" min="1" max="99" step="1" inputmode="numeric" value="' + line.quantity + '" data-cart-qty="' + escapeHTML(p.id) + '" aria-label="Quantity of ' + escapeHTML(p.name) + '">' +
          '<button type="button" data-cart-step="' + escapeHTML(p.id) + '" data-step="1" aria-label="Increase quantity of ' + escapeHTML(p.name) + '">+</button></div>' +
          '<button class="remove-item" type="button" data-remove="' + escapeHTML(p.id) + '">Remove</button>' +
        '</div><strong class="cart-line-price">' + price(p.price == null ? null : p.price * line.quantity) + '</strong></article>';
    }).join('');
    if ($('cart-empty')) $('cart-empty').hidden = count !== 0;
    if ($('cart-subtotal')) $('cart-subtotal').textContent = price(subtotal());
    if ($('cart-total')) $('cart-total').textContent = price(subtotal());
    if ($('cart-review')) $('cart-review').disabled = count === 0;
    if ($('cart-item-count')) $('cart-item-count').textContent = count + (count === 1 ? ' item' : ' items');
  }

  function updateCart() {
    persist();
    renderCart();
  }

  function addToCart(id, quantity = 1) {
    const p = getProduct(id);
    if (!p || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return false;
    const existing = state.cart.find((line) => line.id === id);
    if (existing && existing.quantity + quantity > 99) {
      toast('Maximum 99 of one part. Adjust the quantity in your cart.');
      return false;
    }
    if (existing) existing.quantity += quantity;
    else state.cart.push({ id, quantity });
    updateCart();
    toast(p.name + ' added to your cart.' + (!persistenceAvailable ? ' Saved for this session only.' : ''));
    return true;
  }

  function changeQuantity(id, quantity) {
    const line = state.cart.find((item) => item.id === id);
    if (!line) return;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      toast('Choose a whole-number quantity from 1 to 99.');
      renderCart();
      return;
    }
    line.quantity = quantity;
    updateCart();
  }

  function orderText() {
    const reference = $('order-reference') ? $('order-reference').value.trim() : '';
    return [
      'OLSON & TENGLUND, INC.',
      'PARTS LIST — NOT AN ORDER',
      '',
      'This list has not sent an order or reserved any products.',
      'Prices are from the current published catalog. Items without a price need a quote.',
      'Confirm actual pricing, tax, availability and vehicle fitment with the store.',
      '',
      'Preferred store: ' + storePreferenceText() + ' (preference only; no reservation)',
      'Vehicle: ' + vehicleText(),
      reference ? 'Job / reference: ' + reference : '',
      '',
      ...state.cart.map((line) => {
        const p = getProduct(line.id);
        if (!p) return line.quantity + ' × SKU ' + line.id + ' | Confirm catalog details';
        return line.quantity + ' × ' + p.name + ' | ' + p.id + ' | ' + price(p.price) + ' each | ' + price(p.price == null ? null : p.price * line.quantity);
      }),
      '',
      'Priced items subtotal: ' + price(subtotal()),
      'Tax, shipping and any core charges are not calculated.',
      '',
      'No payment has been collected. Nothing has been sent.'
    ].filter((line) => line !== null).join('\n');
  }

  function renderOrder() {
    if (!$('order-summary')) return;
    $('order-summary').innerHTML =
      '<div class="order-preview-note"><strong>Preview only. This does not place an order.</strong><p>Review this list with the parts counter. No products are reserved and no payment is collected.</p></div>' +
      '<p class="order-vehicle"><strong>Preferred store:</strong> ' + escapeHTML(storePreferenceText()) + ' <small>(preference only; no reservation)</small></p>' +
      '<p class="order-vehicle"><strong>Vehicle:</strong> ' + escapeHTML(vehicleText()) + '</p>' +
      '<div class="order-lines">' + state.cart.map((line) => {
        const p = getProduct(line.id);
        if (!p) return '<div class="order-line"><div><strong>SKU ' + escapeHTML(line.id) + '</strong><small>Qty ' + line.quantity + ' · Confirm catalog details</small></div></div>';
        return '<div class="order-line"><div><strong>' + escapeHTML(p.name) + '</strong><small>' + escapeHTML(p.id) + ' · Qty ' + line.quantity + '</small></div><span>' + price(p.price == null ? null : p.price * line.quantity) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="order-subtotal"><strong>Priced items subtotal</strong><strong>' + price(subtotal()) + '</strong></div>' +
      '<p class="small-note">Quoted prices may be required for unpriced items. Tax, shipping and any core charges are not calculated. Confirm actual products, fitment and availability with the store.</p>';
  }

  function downloadText(text, name) {
    const file = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function copyText(text, successMessage) {
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      toast(successMessage);
    } catch (_) {
      // A visible selection is a usable fallback when clipboard access is unavailable.
      let fallback = $('copy-fallback');
      if (!fallback) {
        fallback = document.createElement('textarea');
        fallback.id = 'copy-fallback';
        fallback.className = 'copy-fallback';
        fallback.readOnly = true;
        fallback.setAttribute('aria-label', 'Text to copy manually');
        (document.querySelector('dialog[open]') || document.body).appendChild(fallback);
      }
      fallback.value = text;
      fallback.focus();
      fallback.select();
      toast('Select and copy the text shown below, or use Download.');
    }
  }

  function quickFeedback(messages, good) {
    const target = $('quick-order-feedback');
    if (!target) return;
    target.textContent = messages.join(' ');
    target.classList.toggle('is-error', !good);
    target.classList.toggle('is-success', good);
    target.hidden = false;
  }

  function parseOrderLines(input) {
    const lines = input.split(/\r?\n/).map((text, index) => ({ text: text.trim(), index: index + 1 })).filter((line) => line.text);
    if (!lines.length) return { errors: ['Enter at least one part number and quantity.'], entries: [] };
    if (lines.length > 100) return { errors: ['Use no more than 100 lines at a time.'], entries: [] };
    const errors = [];
    const entries = new Map();
    lines.forEach(({ text, index }, position) => {
      if (position === 0 && /^(part[\s_-]*(number|no|#)|sku)\s*[,;\t]\s*(quantity|qty)$/i.test(text.replace(/"/g, ''))) return;
      const fields = text.split(/[,;\t]/).map((field) => field.trim().replace(/^"([^"]*)"$/, '$1'));
      if (fields.length !== 2) { errors.push('Line ' + index + ': use part number, quantity.'); return; }
      const id = getProduct(fields[0])?.id || fields[0];
      const quantityText = fields[1];
      if (!byId.has(id)) { errors.push('Line ' + index + ': ' + (id || 'part number') + ' is not a listed SKU.'); return; }
      if (!/^\d+$/.test(quantityText) || Number(quantityText) < 1 || Number(quantityText) > 99) {
        errors.push('Line ' + index + ': quantity must be a whole number from 1 to 99.'); return;
      }
      entries.set(id, (entries.get(id) || 0) + Number(quantityText));
    });
    if (!errors.length && entries.size === 0) errors.push('Add at least one part below the header.');
    entries.forEach((quantity, id) => {
      const inCart = state.cart.find((line) => line.id === id)?.quantity || 0;
      if (inCart + quantity > 99) errors.push(id + ': combined cart quantity would exceed 99.');
    });
    return { errors, entries: [...entries].map(([id, quantity]) => ({ id, quantity })) };
  }

  async function submitQuickOrder() {
    const input = $('quick-order-input');
    if (!input) return;
    const ids = input.value.split(/\r?\n/).map(line => line.split(/[,;\t]/)[0].trim().replace(/^"|"$/g,'')).filter(id => id && !/^(sku|part[ _-]*(number|no|#))$/i.test(id));
    if (ids.length > 100) { quickFeedback(['Use no more than 100 lines.'],false); return; }
    $('quick-order-submit').disabled = true;
    try { for (let i=0;i<ids.length;i+=5) await Promise.all(ids.slice(i,i+5).map(lookupSku)); } catch (_) { quickFeedback(['Unable to check the catalog. Please retry before adding your list.'],false); return; } finally { $('quick-order-submit').disabled = false; }
    const result = parseOrderLines(input.value);
    if (result.errors.length) {
      quickFeedback(result.errors.concat(['Nothing has been added.']), false);
      return;
    }
    result.entries.forEach(({ id, quantity }) => {
      const existing = state.cart.find((line) => line.id === id);
      if (existing) existing.quantity += quantity;
      else state.cart.push({ id, quantity });
    });
    const count = result.entries.reduce((sum, line) => sum + line.quantity, 0);
    updateCart();
    input.value = '';
    if ($('quick-order-file')) $('quick-order-file').value = '';
    quickFeedback([count + ' items added to your cart. Review your list when you’re ready. No order has been placed.'], true);
    toast('Bulk list added to cart.');
  }

  function prepareAccountInquiry(form) {
    const fields = new FormData(form);
    const value = (key) => String(fields.get(key) || '').trim();
    accountDraft = [
      'SHOP ACCOUNT INQUIRY — DRAFT',
      'For Olson & Tenglund, Inc.',
      'Preferred store: ' + storePreferenceText(),
      '',
      'Business: ' + value('business'),
      'Contact: ' + value('name'),
      'Email: ' + value('email'),
      'Phone: ' + value('phone'),
      value('notes') ? 'What we need: ' + value('notes') : '',
      '',
      'I would like to discuss a shop account, current product availability and the ordering options for our business.',
      '',
      'This draft has not been sent. Contact the store to discuss account eligibility, pricing and terms.'
    ].join('\n');
    const result = $('account-result');
    if (result) {
      result.hidden = false;
      result.innerHTML = '<h3>Your draft is ready.</h3><p>Nothing has been sent. Copy or download this inquiry, or call the store to discuss a shop account.</p><pre class="inquiry-preview">' + escapeHTML(accountDraft) + '</pre>';
    }
    if ($('copy-account')) { $('copy-account').hidden = false; $('copy-account').parentElement.hidden = false; }
    if ($('download-account')) $('download-account').hidden = false;
    toast('Inquiry prepared. Nothing has been sent.');
  }

  function bindEvents() {
    $('preferred-store')?.addEventListener('change', event => changeStore(event.target.value));
    $('search-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      state.showAll = true;
      state.query = $('site-search')?.value.trim().slice(0, 150) || '';
      state.category = 'all';
      renderProducts();
      scrollToSection('catalog');
      closeMenus();
    });
    $('search-clear')?.addEventListener('click', () => {
      state.query = '';
      if ($('site-search')) { $('site-search').value = ''; $('site-search').focus(); }
      renderProducts();
    });
    $('catalog-category')?.addEventListener('change', (event) => {
      state.showAll = true;
      state.category = Object.hasOwn(categoryNames, event.target.value) ? event.target.value : 'all';
      renderProducts();
    });
    $('catalog-sort')?.addEventListener('change', (event) => {
      state.showAll = true;
      state.sort = event.target.value;
      renderProducts();
    });
    $('reset-filters')?.addEventListener('click', resetFilters);
    $('show-all-products')?.addEventListener('click', () => renderProducts(true));
    $('mobile-menu-toggle')?.addEventListener('click', () => toggleMenu('mobile'));
    $('category-toggle')?.addEventListener('click', () => toggleMenu('category'));

    $('vehicle-year')?.addEventListener('change', fillVehicleMakes);
    $('vehicle-make')?.addEventListener('change', fillVehicleModels);
    $('vehicle-model')?.addEventListener('change', fillVehicleConfigurations);
    $('vehicle-form')?.addEventListener('submit', event => {
      event.preventDefault();
      if (!event.target.reportValidity()) return;
      const vehicle = vehicleModels.find(v => v.reference_key === $('vehicle-model').value);
      if (!vehicle) return;
      const epa = vehicleConfigs.find(c => String(c.epa_id) === $('vehicle-configuration').value);
      if (vehicleConfigs.length && !epa) { toast('Select your engine and configuration first.'); return; }
      const selected = epa ? {
        ...vehicle, epa_id: epa.epa_id,
        configuration_label: [vehicleEngineLabel(epa), vehicleDriveLabel(epa), vehicleTransmissionLabel(epa)].join(' · ')
      } : vehicle;
      try { garageSaveVehicle(selected); }
      catch (error) { toast(error.message || 'Could not save to My Garage.'); return; }
      // EPA vehicle IDs are not catalog vehicle_key values. Never send EPA IDs as verified fitment filters.
      state.vehicle = null;
      persist();
      vehicleLookupMessage = 'Vehicle saved to My Garage. Browsing all parts; compatibility has not been verified.';
      renderVehicle(); renderProducts(); scrollToSection('catalog');
      toast('Saved to My Garage. Parts compatibility must be confirmed before ordering.');
    });
    $('vehicle-header')?.addEventListener('click', () => { window.location.assign('/vehicle-directory'); });
    window.addEventListener('pageshow', renderVehicle);
    window.addEventListener('storage', event => { if (event.key === GARAGE_KEY) renderVehicle(); });


    $('cart-open')?.addEventListener('click', () => { renderCart(); openDialog('cart-dialog'); });
    $('cart-close')?.addEventListener('click', () => closeDialog($('cart-dialog')));
    $('cart-review')?.addEventListener('click', () => {
      if (!state.cart.length) return;
      renderOrder();
      openDialog('order-dialog');
    });
    $('download-order')?.addEventListener('click', () => {
      downloadText(orderText(), 'olson-tenglund-parts-list.txt');
      toast('Parts list downloaded. No order has been placed.');
    });
    $('copy-order')?.addEventListener('click', () => copyText(orderText(), 'Parts list copied. Nothing has been sent.'));
    $('quick-order-form')?.addEventListener('submit', (event) => { event.preventDefault(); submitQuickOrder(); });
    $('quick-order-file')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 100000) { quickFeedback(['Please choose a CSV file smaller than 100 KB.'], false); event.target.value = ''; return; }
      if (!/\.csv$/i.test(file.name)) { quickFeedback(['Choose a .csv file with part number and quantity columns.'], false); event.target.value = ''; return; }
      try {
        const text = await file.text();
        if ($('quick-order-input')) $('quick-order-input').value = text.replace(/^\uFEFF/, '');
        quickFeedback(['CSV loaded locally. Review the list, then choose Add list to cart.'], true);
      } catch (_) { quickFeedback(['The file could not be read. Paste the part numbers and quantities instead.'], false); }
    });
    $('account-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (event.target.reportValidity()) prepareAccountInquiry(event.target);
    });
    $('copy-account')?.addEventListener('click', () => {
      if (accountDraft) copyText(accountDraft, 'Inquiry draft copied. Nothing has been sent.');
    });
    $('download-account')?.addEventListener('click', () => {
      if (accountDraft) downloadText(accountDraft, 'olson-tenglund-shop-inquiry-draft.txt');
    });

    document.addEventListener('click', (event) => {
      const button = event.target.closest('button, a');
      if (!button) return;
      if (button.hasAttribute('data-select-store')) { changeStore(button.dataset.selectStore); }
      if (button.hasAttribute('data-category')) {
        state.showAll = true;
        state.category = Object.hasOwn(categoryNames, button.dataset.category) ? button.dataset.category : 'all';
        state.query = '';
        if ($('site-search')) $('site-search').value = '';
        renderProducts();
        closeMenus();
        scrollToSection('catalog');
      }
      if (button.hasAttribute('data-product')) openProduct(button.dataset.product);
      if (button.hasAttribute('data-add')) addToCart(button.dataset.add);
      if (button.hasAttribute('data-cart-step')) {
        const line = state.cart.find((item) => item.id === button.dataset.cartStep);
        if (line) changeQuantity(line.id, line.quantity + Number(button.dataset.step));
      }
      if (button.hasAttribute('data-remove')) {
        state.cart = state.cart.filter((line) => line.id !== button.dataset.remove);
        updateCart();
        toast('Part removed from cart.');
      }
      if (button.hasAttribute('data-reset-filters')) resetFilters();
      if (button.hasAttribute('data-remove-category')) { state.category = 'all'; renderProducts(); }
      if (button.hasAttribute('data-remove-query')) {
        state.query = '';
        if ($('site-search')) $('site-search').value = '';
        renderProducts();
      }
      if (button.hasAttribute('data-close-dialog')) closeDialog(button.closest('dialog'));
      if (button.hasAttribute('data-open-account')) openDialog('account-dialog');
      if (button.hasAttribute('data-scroll')) {
        event.preventDefault();
        closeDialog(button.closest('dialog'));
        closeMenus();
        scrollToSection(button.dataset.scroll.replace(/^#/, ''));
      }
      if (button.closest('#mobile-menu') && button.tagName === 'A') closeMenus();
    });
    document.addEventListener('change', (event) => {
      if (event.target.matches('[data-cart-qty]')) changeQuantity(event.target.dataset.cartQty, Number(event.target.value));
    });
    document.addEventListener('submit', (event) => {
      if (event.target.id !== 'product-add-form') return;
      event.preventDefault();
      if (!event.target.reportValidity()) return;
      const quantity = Number($('product-quantity').value);
      if (addToCart(event.target.dataset.productId, quantity)) closeDialog($('product-dialog'));
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('#category-menu, #category-toggle, #mobile-menu, #mobile-menu-toggle')) closeMenus();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenus();
    });
    document.querySelectorAll('dialog').forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(dialog);
      });
      dialog.addEventListener('close', () => {
        const fallback = dialog.querySelector('#copy-fallback');
        if (fallback) fallback.remove();
        const opener = dialogOpeners.get(dialog);
        if (opener?.isConnected && !document.querySelector('dialog[open]')) opener.focus({ preventScroll: true });
      });
    });
  }

  async function init() {
    renderCart();
    bindEvents();
    await loadStores();
    await restore();
    await Promise.all([renderProducts(), configureVehicle()]);
    renderCart();
    if ($('year')) $('year').textContent = String(new Date().getFullYear());
    document.documentElement.classList.add('js-ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
