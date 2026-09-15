// ============================================================================
// app.js — Vicmic Kurir. Plain JS, no bundler (same philosophy as the main
// dashboard): Capacitor auto-injects its native bridge, so plugins are read
// straight off window.Capacitor.Plugins rather than imported.
//
// Flow: Google login via Supabase's redirect OAuth (opened in a system
// Custom Tab, not this app's own WebView — Google blocks sign-in inside
// embedded webviews) -> deep link back into the app -> pick origin and
// destination on a map -> start/finish a trip -> background GPS ping while
// it runs.
//
// Free/keyless services behind the location features — all wrapped so a
// failure degrades to "type it in manually" instead of blocking the trip:
//   - Leaflet + Esri World Street Map basemap tiles: the maps.
//   - Photon (photon.komoot.io): place search + reverse geocoding.
//     NOTE: its public instance only accepts lang=default/de/en/fr — passing
//     lang=id returns HTTP 400 with a JSON body, which silently looks like
//     "no results" if you don't check res.ok.
//   - OSRM (router.project-osrm.org): driving distance, duration, and the
//     route geometry drawn on the preview map.
// ============================================================================

const { App, Browser, BackgroundGeolocation } = window.Capacitor?.Plugins || {};
const CFG = window.VICMIC_CONFIG;

const PHOTON_SEARCH = 'https://photon.komoot.io/api/';
const PHOTON_REVERSE = 'https://photon.komoot.io/reverse';
const OSRM_ROUTE = 'https://router.project-osrm.org/route/v1/driving/';
// CARTO's basemaps (previously used here) now require an API key — every
// tile silently came back as a 200 OK image whose actual pixels just say
// "API KEY REQUIRED", which a status-code check alone doesn't catch. Esri's
// World Street Map tile service is genuinely keyless and was verified by
// downloading and looking at an actual tile before switching to it.
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
const TILE_ATTR = 'Tiles &copy; Esri — Source: Esri, HERE, Garmin, FAO, NOAA, USGS';
const DEFAULT_CENTER = [-6.25, 106.7]; // Jabodetabek, until a real point exists

const supabase = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // the callback URL arrives via Capacitor's deep-link event
    flowType: 'pkce',
  },
});

const state = {
  user: null,
  trip: null,
  watcherId: null,
  courierRate: CFG.DEFAULT_COURIER_RATE_PER_KM,
  lastPingAt: 0,
  timerInterval: null,

  points: { from: null, to: null }, // { lat, lng, label }
  route: null, // { km, minutes, geometry }
  manualKm: null, // set only when the courier overrides the calculated value

  picker: { target: null, map: null, center: null, address: '', searchResults: [] },
  previewMap: null,
  previewLayer: null,
  favorites: [],
  favError: null,
};

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function parseDecimalId(raw) {
  // Same rule as the dashboard: "." is a thousands separator, "," is decimal.
  return parseFloat(String(raw ?? '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
}

function formatKm(n) {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

function setError(msg) {
  $('login-error').textContent = msg || '';
}

function showBanner(msg) {
  const el = $('status-banner');
  el.hidden = !msg;
  el.textContent = msg || '';
}

function setHint(msg, warn = false) {
  const el = $('distance-hint');
  el.textContent = msg || '';
  el.classList.toggle('is-warn', !!warn);
}

function newMap(elId, opts = {}) {
  const map = L.map(elId, { zoomControl: false, attributionControl: true, ...opts }).setView(DEFAULT_CENTER, 12);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
  return map;
}

// A CSS-drawn teardrop marker (no image asset) for a route's start/end
// points — matches the shape of the centre pin in the location picker.
function dropPinIcon(color) {
  return L.divIcon({
    className: 'drop-pin',
    html: `<span class="drop-pin-head" style="--pin-color:${color}"></span>`,
    iconSize: [24, 32],
    iconAnchor: [12, 32],
  });
}

// ---- view switching ---------------------------------------------------

function showLogin() {
  $('view-login').hidden = false;
  $('view-trip').hidden = true;
}

function showTrip() {
  $('view-login').hidden = true;
  $('view-trip').hidden = false;
  $('user-name').textContent = state.user.name || state.user.email;
  $('user-email').textContent = state.user.email;
}

// ---- auth --------------------------------------------------------------

async function handleGoogleLogin() {
  setError('');
  const btn = $('btn-google-login');
  btn.disabled = true;
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: CFG.OAUTH_REDIRECT, skipBrowserRedirect: true },
    });
    if (error) throw error;
    await Browser.open({ url: data.url });
  } catch (e) {
    console.error('signInWithOAuth:', e);
    setError('Gagal membuka login Google: ' + (e.message || e));
    btn.disabled = false;
  }
}

async function handleDeepLink(url) {
  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const errDesc = parsed.searchParams.get('error_description');
    await Browser.close().catch(() => {});
    if (errDesc) throw new Error(errDesc);
    if (!code) return;
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    await onAuthReady();
  } catch (e) {
    console.error('handleDeepLink:', e);
    setError('Login gagal: ' + (e.message || e));
    $('btn-google-login').disabled = false;
  }
}

async function onAuthReady() {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session;
  if (!session) return showLogin();

  const email = (session.user.email || '').toLowerCase();
  const { data: userRow, error } = await supabase
    .from('allowed_users')
    .select('email, role')
    .eq('email', email)
    .maybeSingle();

  if (error || !userRow || !['sales_kurir', 'admin'].includes(userRow.role)) {
    await supabase.auth.signOut();
    setError('Akun ini tidak terdaftar sebagai kurir. Hubungi admin.');
    return showLogin();
  }

  state.user = {
    email,
    role: userRow.role,
    name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || email.split('@')[0],
  };
  showTrip();
  await loadCourierRate();
  loadFavorites();
  await loadState();
}

async function logout() {
  stopWatcher();
  await supabase.auth.signOut();
  state.user = null;
  state.trip = null;
  showLogin();
}

async function loadCourierRate() {
  const { data } = await supabase
    .from('app_settings')
    .select('setting_value')
    .eq('setting_key', 'courier_rate_per_km')
    .maybeSingle();
  const n = parseFloat(data?.setting_value);
  if (!isNaN(n) && n > 0) state.courierRate = n;
}

// ---- trip lifecycle ------------------------------------------------------

async function loadState() {
  const { data, error } = await supabase
    .from('courier_logs')
    .select('*')
    .eq('user_email', state.user.email)
    .eq('status', 'sedang jalan')
    .maybeSingle();

  if (error) {
    showBanner('Gagal memuat status perjalanan: ' + error.message);
    return;
  }

  state.trip = data || null;
  if (state.trip) {
    renderActive();
    startWatcher(state.trip.id); // idempotent: resumes tracking after a relaunch
  } else {
    stopWatcher();
    renderStart();
  }
}

function renderStart() {
  $('card-start').hidden = false;
  $('card-active').hidden = true;
  showBanner('');
  if (state.timerInterval) clearInterval(state.timerInterval);
}

function renderActive() {
  $('card-start').hidden = true;
  $('card-active').hidden = false;
  showBanner('');
  $('active-from').textContent = state.trip.from_location || '-';
  $('active-to').textContent = state.trip.to_location || '-';
  $('active-km').textContent = state.trip.distance_km;

  if (state.timerInterval) clearInterval(state.timerInterval);
  const startMs = new Date(state.trip.start_time).getTime();
  const tick = () => {
    $('active-timer').textContent = formatDuration(Date.now() - startMs);
  };
  tick();
  state.timerInterval = setInterval(tick, 1000);
}

function effectiveKm() {
  if (state.manualKm != null) return state.manualKm;
  return state.route ? state.route.km : null;
}

async function startTrip() {
  const from = state.points.from;
  const to = state.points.to;
  const km = effectiveKm();

  if (!from || !to) return showBanner('Pilih lokasi asal dan tujuan dulu.');
  if (km == null || isNaN(km) || km <= 0) return showBanner('Jarak belum terisi. Isi manual kalau perhitungan otomatis gagal.');

  const btn = $('btn-start');
  btn.disabled = true;
  try {
    const now = new Date();
    const { data: inserted, error } = await supabase
      .from('courier_logs')
      .insert([
        {
          user_email: state.user.email,
          date: now.toISOString().split('T')[0],
          time: now.toTimeString().substring(0, 5),
          from_location: from.label,
          to_location: to.label,
          distance_km: km,
          amount_rp: Math.round(km * state.courierRate),
          status: 'sedang jalan',
          start_time: now.toISOString(),
        },
      ])
      .select('*')
      .maybeSingle();
    if (error) throw error;

    resetTripForm();
    state.trip = inserted;
    renderActive();
    startWatcher(inserted.id);
  } catch (e) {
    console.error('startTrip:', e);
    showBanner('Gagal memulai perjalanan: ' + (e.message || e));
  } finally {
    btn.disabled = false;
  }
}

function resetTripForm() {
  state.points = { from: null, to: null };
  state.route = null;
  state.manualKm = null;
  $('f-distance').value = '';
  $('manual-km-wrap').hidden = true;
  $('route-preview').hidden = true;
  setHint('');
  renderLegs();
  renderDistance();
}

async function finishTrip() {
  if (!state.trip) return;
  const btn = $('btn-finish');
  btn.disabled = true;
  try {
    const { error } = await supabase
      .from('courier_logs')
      .update({ status: 'selesai', end_time: new Date().toISOString() })
      .eq('id', state.trip.id);
    if (error) throw error;
    stopWatcher();
    state.trip = null;
    renderStart();
  } catch (e) {
    console.error('finishTrip:', e);
    showBanner('Gagal menyelesaikan perjalanan: ' + (e.message || e));
  } finally {
    btn.disabled = false;
  }
}

// ---- background GPS ping --------------------------------------------------
// @capacitor-community/background-geolocation runs a real Android foreground
// service (the persistent notification is required by Android — expected, not
// a bug), so updates keep flowing with the screen locked.

function startWatcher(tripId) {
  if (!BackgroundGeolocation) {
    showBanner('Plugin GPS tidak tersedia di build ini.');
    return;
  }
  if (state.watcherId) return;
  state.lastPingAt = 0;

  // addWatcher is a "callback"-style native method (RETURN_CALLBACK), which
  // is supposed to resolve a Promise<watcherId> — but under
  // android.useLegacyBridge (needed separately so GPS doesn't stop after
  // 5 minutes locked, see the plugin's README/issue #89) that promise
  // wrapping breaks and the call can return a non-promise value instead.
  // Promise.resolve(...) normalizes either case instead of crashing on
  // "...then is not a function", which was blocking every trip start.
  let result;
  try {
    result = BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: 'Vicmic Kurir',
        backgroundMessage: 'Mengirim posisi perjalanan ke admin…',
        requestPermissions: true,
        stale: false,
        distanceFilter: 30,
      },
      (location, error) => {
        if (error) {
          console.warn('BackgroundGeolocation error:', error.message);
          return;
        }
        pingPosition(tripId, location);
      }
    );
  } catch (e) {
    console.error('addWatcher threw synchronously:', e);
    showBanner('Gagal mengaktifkan GPS: ' + (e.message || e));
    return;
  }

  Promise.resolve(result)
    .then((id) => {
      // A falsy/non-string id means the bridge didn't hand back a usable
      // watcher id (the known legacy-bridge quirk above) — GPS pings should
      // still work since the native side registers the callback
      // synchronously regardless, but removeWatcher() won't be able to
      // target this watcher precisely later. See stopWatcher().
      state.watcherId = typeof id === 'string' && id ? id : true;
    })
    .catch((e) => {
      console.warn('addWatcher registration ack failed (tracking may still be running):', e);
      state.watcherId = true; // best-effort marker so stopWatcher() still tries to clean up
    });
}

function stopWatcher() {
  if (state.watcherId && BackgroundGeolocation) {
    const id = typeof state.watcherId === 'string' ? state.watcherId : null;
    if (id) {
      Promise.resolve(BackgroundGeolocation.removeWatcher({ id })).catch(() => {});
    } else {
      // No real id to target (see startWatcher) — the persistent notification
      // may keep running until the app is fully closed. Not silently ignored:
      // surfaced so it's easy to spot during testing rather than discovered later.
      console.warn('stopWatcher: no watcher id captured — GPS foreground service may keep running until the app is closed.');
    }
  }
  state.watcherId = null;
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

async function pingPosition(tripId, location) {
  const now = Date.now();
  if (now - state.lastPingAt < 15000) return; // throttle writes to ~1/15s
  state.lastPingAt = now;
  const { error } = await supabase
    .from('courier_logs')
    .update({
      last_lat: location.latitude,
      last_lng: location.longitude,
      last_ping_at: new Date().toISOString(),
    })
    .eq('id', tripId);
  if (error) console.warn('pingPosition:', error.message);

  // Breadcrumb trail for the admin "Lihat Rute" button (migration 008) — a
  // full history of points, unlike last_lat/last_lng above which only ever
  // holds the latest one.
  const { error: trackErr } = await supabase
    .from('courier_positions')
    .insert({ trip_id: tripId, user_email: state.user.email, lat: location.latitude, lng: location.longitude });
  if (trackErr) console.warn('pingPosition (track):', trackErr.message);
}

// ---- legs + distance readout ---------------------------------------------

function renderLegs() {
  for (const target of ['from', 'to']) {
    const el = $(target === 'from' ? 'v-from' : 'v-to');
    const p = state.points[target];
    el.textContent = p ? p.label : target === 'from' ? 'Pilih lokasi asal' : 'Pilih lokasi tujuan';
    el.classList.toggle('is-empty', !p);
  }
}

function renderDistance() {
  const km = effectiveKm();
  $('distance-value').textContent = km == null ? '–' : `${formatKm(km)} KM`;
}

// ---- route: distance, duration, and the line on the preview map ----------

async function recalcRoute() {
  const { from, to } = state.points;
  if (!from || !to) return;

  setHint('Menghitung rute…');
  try {
    const url = `${OSRM_ROUTE}${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const json = await res.json();
    if (json.code !== 'Ok' || !json.routes?.length) throw new Error('Rute tidak ditemukan');

    const r = json.routes[0];
    state.route = {
      km: Math.round((r.distance / 1000) * 10) / 10,
      minutes: Math.round(r.duration / 60),
      geometry: r.geometry,
    };
    state.manualKm = null; // a fresh route supersedes an earlier manual value
    $('f-distance').value = '';
    $('manual-km-wrap').hidden = true;

    renderDistance();
    drawRoutePreview();
    setHint('Jarak & waktu dihitung otomatis dari rute jalan.');
  } catch (e) {
    console.warn('recalcRoute:', e);
    state.route = null;
    $('route-preview').hidden = true;
    renderDistance();
    setHint('Gagal hitung rute otomatis — isi jarak manual di bawah.', true);
    $('manual-km-wrap').hidden = false;
  }
}

function drawRoutePreview() {
  if (!state.route?.geometry) return;
  const wrap = $('route-preview');
  wrap.hidden = false;

  if (!state.previewMap) {
    state.previewMap = newMap('route-map', {
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      boxZoom: false,
      keyboard: false,
    });
  }
  const map = state.previewMap;
  setTimeout(() => map.invalidateSize(), 50);

  if (state.previewLayer) state.previewLayer.remove();

  const latlngs = state.route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  const line = L.polyline(latlngs, { color: '#16a34a', weight: 5, opacity: 0.9, lineJoin: 'round' });
  const start = L.marker(latlngs[0], { icon: dropPinIcon('#16a34a') });
  const end = L.marker(latlngs[latlngs.length - 1], { icon: dropPinIcon('#dc2626') });

  state.previewLayer = L.layerGroup([line, start, end]).addTo(map);
  setTimeout(() => map.fitBounds(line.getBounds(), { padding: [26, 26] }), 60);

  $('route-km').textContent = `${formatKm(state.route.km)} KM`;
  $('route-eta').textContent = `± ${state.route.minutes} menit`;
}

function toggleManualKm() {
  const wrap = $('manual-km-wrap');
  wrap.hidden = !wrap.hidden;
  if (!wrap.hidden) $('f-distance').focus();
}

function onManualKmInput() {
  const v = parseDecimalId($('f-distance').value);
  state.manualKm = isNaN(v) || v <= 0 ? null : v;
  renderDistance();
  if (state.manualKm != null) setHint('Jarak diisi manual.');
}

// ---- map picker ----------------------------------------------------------

function ensurePickerMap() {
  if (state.picker.map) return;
  state.picker.map = newMap('mappicker-map');
  state.picker.map.on('moveend', () => reverseGeocodeCenter());
}

function openMapPicker(target) {
  state.picker.target = target;
  $('mp-sheet-label').textContent = target === 'from' ? 'Lokasi Asal' : 'Lokasi Tujuan';
  $('mp-search').value = '';
  hideSearchResults();
  $('view-mappicker').hidden = false;
  renderFavChips();

  ensurePickerMap();
  setTimeout(() => state.picker.map.invalidateSize(), 60);

  const existing = state.points[target];
  if (existing) {
    state.picker.center = { lat: existing.lat, lng: existing.lng };
    setPickerAddress(existing.label);
    state.picker.map.setView([existing.lat, existing.lng], 16);
  } else if (target === 'from') {
    locateMe(); // origin defaults to where the courier is standing
  } else {
    reverseGeocodeCenter();
  }
}

function closeMapPicker() {
  $('view-mappicker').hidden = true;
  state.picker.target = null;
}

function confirmMapPicker() {
  const target = state.picker.target;
  if (!target || !state.picker.center) return;
  state.points[target] = { ...state.picker.center, label: state.picker.address };
  closeMapPicker();
  renderLegs();
  recalcRoute();
}

function setPickerAddress(text) {
  state.picker.address = text;
  $('mp-address').textContent = text;
}

function locateMe() {
  if (!navigator.geolocation) return reverseGeocodeCenter();
  setPickerAddress('Mencari lokasi Anda…');
  navigator.geolocation.getCurrentPosition(
    (pos) => state.picker.map.setView([pos.coords.latitude, pos.coords.longitude], 16),
    () => reverseGeocodeCenter(),
    { timeout: 8000, enableHighAccuracy: true }
  );
}

async function reverseGeocodeCenter() {
  const map = state.picker.map;
  if (!map) return;
  const c = map.getCenter();
  state.picker.center = { lat: c.lat, lng: c.lng };
  setPickerAddress('Mencari alamat…');
  try {
    const res = await fetch(`${PHOTON_REVERSE}?lon=${c.lng}&lat=${c.lat}`);
    if (!res.ok) throw new Error(`Photon reverse ${res.status}`);
    const json = await res.json();
    setPickerAddress(formatPhotonFeature(json.features?.[0]) || `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`);
  } catch (e) {
    console.warn('reverseGeocodeCenter:', e);
    setPickerAddress(`${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`);
  }
}

function formatPhotonFeature(f) {
  if (!f) return '';
  const p = f.properties || {};
  return [p.name, p.street, p.district || p.city, p.state].filter(Boolean).join(', ');
}

// ---- place search --------------------------------------------------------

let searchDebounce;
function onSearchInput(e) {
  clearTimeout(searchDebounce);
  const q = e.target.value.trim();
  if (q.length < 3) return hideSearchResults();
  searchDebounce = setTimeout(() => runSearch(q), 350);
}

async function runSearch(q) {
  const el = $('mp-search-results');
  el.innerHTML = '<div class="mp-search-result muted">Mencari…</div>';
  el.hidden = false;
  try {
    const center = state.picker.map?.getCenter();
    const bias = center ? `&lat=${center.lat}&lon=${center.lng}` : '';
    const res = await fetch(`${PHOTON_SEARCH}?q=${encodeURIComponent(q)}&limit=6${bias}`);
    if (!res.ok) throw new Error(`Photon search ${res.status}`);
    const json = await res.json();
    state.picker.searchResults = json.features || [];
    renderSearchResults();
  } catch (e) {
    console.warn('runSearch:', e);
    el.innerHTML = '<div class="mp-search-result muted">Gagal mencari — coba lagi.</div>';
  }
}

function renderSearchResults() {
  const el = $('mp-search-results');
  const results = state.picker.searchResults || [];
  el.hidden = false;
  if (!results.length) {
    el.innerHTML = '<div class="mp-search-result muted">Tidak ditemukan.</div>';
    return;
  }
  el.innerHTML = results
    .map((f, i) => `<div class="mp-search-result" data-idx="${i}">${escapeHtml(formatPhotonFeature(f) || 'Lokasi')}</div>`)
    .join('');
}

function hideSearchResults() {
  $('mp-search-results').hidden = true;
}

function selectSearchResult(feature) {
  if (!feature) return;
  hideSearchResults();
  $('mp-search').value = '';
  $('mp-search').blur();
  const [lng, lat] = feature.geometry.coordinates;
  state.picker.map.setView([lat, lng], 17); // moveend triggers reverse geocoding
}

// ---- favorites (saved places, shown as chips inside the picker) ----------

async function loadFavorites() {
  const { data, error } = await supabase
    .from('courier_favorite_addresses')
    .select('*')
    .eq('user_email', state.user.email)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('loadFavorites:', error.message);
    state.favorites = [];
    state.favError = error.message;
  } else {
    state.favorites = data || [];
    state.favError = null;
  }
  renderFavChips();
}

function renderFavChips() {
  const el = $('mp-chips');
  if (!el) return;
  const chips = [
    `<button type="button" class="mp-chip is-primary" data-locate="1">Lokasi saya</button>`,
  ];
  for (const f of state.favorites) {
    chips.push(
      `<span class="mp-chip" data-fav="${f.id}">
         <span class="mp-chip-text">${escapeHtml(f.address)}</span>
         <button type="button" class="mp-chip-del" data-favdel="${f.id}" aria-label="Hapus">&times;</button>
       </span>`
    );
  }
  if (!state.favorites.length) {
    chips.push(`<span class="mp-chips-empty">Simpan lokasi biar tidak cari ulang →</span>`);
  }
  el.innerHTML = chips.join('');
}

function useFavorite(id) {
  const fav = state.favorites.find((f) => String(f.id) === String(id));
  if (!fav || !state.picker.map) return;
  setPickerAddress(fav.address);
  state.picker.center = { lat: fav.lat, lng: fav.lng };
  state.picker.map.setView([fav.lat, fav.lng], 17);
}

async function saveFavorite() {
  if (!state.picker.center || !state.picker.address) return;
  const btn = $('btn-fav-save');
  btn.disabled = true;
  const { error } = await supabase.from('courier_favorite_addresses').insert({
    user_email: state.user.email,
    address: state.picker.address,
    lat: state.picker.center.lat,
    lng: state.picker.center.lng,
  });
  btn.disabled = false;
  if (error) {
    console.warn('saveFavorite:', error.message);
    setPickerAddress(state.picker.address + ' — gagal disimpan');
    return;
  }
  await loadFavorites();
}

async function deleteFavorite(id) {
  const { error } = await supabase.from('courier_favorite_addresses').delete().eq('id', id);
  if (error) return console.warn('deleteFavorite:', error.message);
  state.favorites = state.favorites.filter((f) => String(f.id) !== String(id));
  renderFavChips();
}

// ---- history & commission recap (this month, this courier's own rows) ----

function formatRupiah(n) {
  return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
}

async function openHistory() {
  $('view-history').hidden = false;
  $('history-list').innerHTML = '<p class="history-empty">Memuat…</p>';

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  const monthStartKey = startOfMonth.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('courier_logs')
    .select('*')
    .eq('user_email', state.user.email)
    .gte('date', monthStartKey)
    .order('start_time', { ascending: false });

  if (error) {
    $('history-list').innerHTML = `<p class="history-empty">Gagal memuat: ${escapeHtml(error.message)}</p>`;
    return;
  }
  renderHistory(data || []);
}

function closeHistory() {
  $('view-history').hidden = true;
}

function renderHistory(rows) {
  let totalKm = 0;
  let totalRp = 0;

  const items = rows
    .map((r) => {
      const done = r.status !== 'sedang jalan';
      if (done) {
        totalKm += Number(r.distance_km) || 0;
        totalRp += Number(r.amount_rp) || 0;
      }
      const dateStr = r.date ? new Date(r.date).toLocaleDateString('id-ID') : '-';
      return `
        <div class="history-item">
          <div class="history-item-top">
            <span class="history-date">${escapeHtml(dateStr)}</span>
            <span class="history-status${done ? '' : ' is-active'}">${done ? 'Selesai' : 'Sedang Jalan'}</span>
          </div>
          <div class="history-route">${escapeHtml(r.from_location)} → ${escapeHtml(r.to_location)}</div>
          <div class="history-meta">
            <span>${r.distance_km} KM</span>
            <span class="komisi">${done ? formatRupiah(r.amount_rp) : '—'}</span>
          </div>
        </div>`;
    })
    .join('');

  $('history-list').innerHTML = items || '<p class="history-empty">Belum ada perjalanan bulan ini.</p>';
  $('hs-km').textContent = `${formatKm(totalKm)} KM`;
  $('hs-rp').textContent = formatRupiah(totalRp);
}

// ---- wiring ---------------------------------------------------------------

function init() {
  $('btn-google-login').addEventListener('click', handleGoogleLogin);
  $('btn-logout').addEventListener('click', logout);
  $('btn-start').addEventListener('click', startTrip);
  $('btn-finish').addEventListener('click', finishTrip);
  $('btn-history').addEventListener('click', openHistory);
  $('btn-history-close').addEventListener('click', closeHistory);

  document.querySelectorAll('[data-pick]').forEach((el) =>
    el.addEventListener('click', () => openMapPicker(el.dataset.pick))
  );

  $('btn-manual-km').addEventListener('click', toggleManualKm);
  $('f-distance').addEventListener('input', onManualKmInput);

  $('btn-mappicker-cancel').addEventListener('click', closeMapPicker);
  $('btn-mappicker-confirm').addEventListener('click', confirmMapPicker);
  $('btn-mp-locate').addEventListener('click', locateMe);
  $('btn-fav-save').addEventListener('click', saveFavorite);

  $('mp-search').addEventListener('input', onSearchInput);
  $('mp-search-results').addEventListener('click', (e) => {
    const item = e.target.closest('[data-idx]');
    if (item) selectSearchResult(state.picker.searchResults[Number(item.dataset.idx)]);
  });

  $('mp-chips').addEventListener('click', (e) => {
    const del = e.target.closest('[data-favdel]');
    if (del) {
      e.stopPropagation();
      deleteFavorite(del.dataset.favdel);
      return;
    }
    if (e.target.closest('[data-locate]')) return locateMe();
    const fav = e.target.closest('[data-fav]');
    if (fav) useFavorite(fav.dataset.fav);
  });

  App?.addListener('appUrlOpen', ({ url }) => handleDeepLink(url));

  App?.addListener('resume', () => {
    if (state.user) loadState();
  });

  // Registering this listener suppresses Android's default back behaviour,
  // so we own it: close whatever overlay is open, else exit.
  App?.addListener('backButton', () => {
    if (!$('mp-search-results').hidden) return hideSearchResults();
    if (!$('view-mappicker').hidden) return closeMapPicker();
    if (!$('view-history').hidden) return closeHistory();
    App.exitApp();
  });

  renderLegs();
  renderDistance();
  onAuthReady();
}

document.addEventListener('DOMContentLoaded', init);
