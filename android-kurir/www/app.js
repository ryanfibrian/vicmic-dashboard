// ============================================================================
// app.js — Vicmic Kurir. Plain JS, no bundler (same philosophy as the main
// dashboard): Capacitor auto-injects its native bridge, so plugins are read
// straight off window.Capacitor.Plugins rather than imported.
//
// Flow: Google login via Supabase's redirect OAuth (opened in a system
// Custom Tab, not this app's own WebView — Google blocks sign-in inside
// embedded webviews) -> deep link back into the app -> exchange the code for
// a session -> start/finish a trip -> background GPS ping while it runs.
//
// Location picking (Gojek-style: tap a field, pick a point on a map or
// search a place, distance auto-calculated) uses free/keyless public
// services — no billing, but also no uptime guarantee, so every call here
// degrades to "fill it in manually" on failure rather than blocking:
//   - Leaflet + OpenStreetMap tiles: the map itself.
//   - Photon (photon.komoot.io): place search + reverse geocoding.
//   - OSRM (router.project-osrm.org): driving-distance route calculation.
// ============================================================================

const { App, Browser, BackgroundGeolocation } = window.Capacitor?.Plugins || {};
const CFG = window.VICMIC_CONFIG;

const PHOTON_SEARCH = 'https://photon.komoot.io/api/';
const PHOTON_REVERSE = 'https://photon.komoot.io/reverse';
const OSRM_ROUTE = 'https://router.project-osrm.org/route/v1/driving/';
const DEFAULT_MAP_CENTER = [-6.25, 106.7]; // Jabodetabek-ish; overridden once a point is picked

const supabase = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // we hand the callback URL to Capacitor's deep-link event instead
    flowType: 'pkce',
  },
});

const state = {
  user: null, // { email, role }
  trip: null, // active courier_logs row, or null
  watcherId: null,
  courierRate: CFG.DEFAULT_COURIER_RATE_PER_KM,
  lastPingAt: 0,
  timerInterval: null,

  points: { from: null, to: null }, // { lat, lng, label } once picked via map/search/favorite
  lastAutoKm: null,

  picker: { target: null, map: null, center: null, address: '', searchResults: [] },
  favTarget: null,
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
  if (!msg) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = msg;
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

// ---- auth: Google login via Supabase redirect OAuth --------------------

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
    if (!code) return; // not an auth callback we care about
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    await onAuthReady();
  } catch (e) {
    console.error('handleDeepLink:', e);
    setError('Login gagal: ' + (e.message || e));
    $('btn-google-login').disabled = false;
  }
}

// After a session exists (fresh login or app relaunch), verify the account
// is a whitelisted courier and load whatever trip state applies.
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
  await loadState();
}

async function logout() {
  stopWatcher();
  await supabase.auth.signOut();
  state.user = null;
  state.trip = null;
  showLogin();
}

// ---- commission rate (mirrors PriceCalc.courierRatePerKm on the web) ---

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
    startWatcher(state.trip.id); // idempotent: resumes tracking after an app relaunch
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

async function startTrip() {
  const from = $('f-from').value.trim();
  const to = $('f-to').value.trim();
  const km = parseDecimalId($('f-distance').value);

  if (!from || !to) return showBanner('Isi lokasi asal dan tujuan.');
  if (isNaN(km) || km <= 0) return showBanner('Jarak KM tidak valid.');

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
          from_location: from,
          to_location: to,
          distance_km: km,
          amount_rp: Math.round(km * state.courierRate),
          status: 'sedang jalan',
          start_time: now.toISOString(),
        },
      ])
      .select('*')
      .maybeSingle();
    if (error) throw error;

    $('f-from').value = '';
    $('f-to').value = '';
    $('f-distance').value = '';
    delete $('f-distance').dataset.auto;
    state.points = { from: null, to: null };
    clearDistanceHint();
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
// service (persistent notification required by Android — this is expected,
// not a bug) so updates keep flowing even with the screen locked / app
// backgrounded, unlike a plain browser tab.

function startWatcher(tripId) {
  if (!BackgroundGeolocation) {
    showBanner('Plugin GPS tidak tersedia di build ini.');
    return;
  }
  if (state.watcherId) return; // already running for this session
  state.lastPingAt = 0;

  BackgroundGeolocation.addWatcher(
    {
      backgroundTitle: 'Vicmic Kurir',
      backgroundMessage: 'Mengirim posisi perjalanan ke admin…',
      requestPermissions: true,
      stale: false,
      distanceFilter: 30, // metres; paired with the time throttle below
    },
    (location, error) => {
      if (error) {
        console.warn('BackgroundGeolocation error:', error.message);
        return;
      }
      pingPosition(tripId, location);
    }
  )
    .then((id) => {
      state.watcherId = id;
    })
    .catch((e) => {
      console.error('addWatcher:', e);
      showBanner('Gagal mengaktifkan GPS: ' + (e.message || e));
    });
}

function stopWatcher() {
  if (state.watcherId && BackgroundGeolocation) {
    BackgroundGeolocation.removeWatcher({ id: state.watcherId }).catch(() => {});
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
}

// ---- location fields: invalidate the stored point on manual edit --------
// A point (lat/lng) is only trustworthy as long as the text matches what was
// picked. Once the courier types over it by hand, drop the point so a stale
// coordinate doesn't silently feed into the distance calculation.

function wireLocationField(inputId, target) {
  $(inputId).addEventListener('input', () => {
    state.points[target] = null;
    clearDistanceHint();
  });
}

// ---- distance auto-calc (OSRM) -------------------------------------------

function clearDistanceHint() {
  $('distance-hint').innerHTML = '';
}

async function recalcDistance() {
  const { from, to } = state.points;
  if (!from || !to) return;
  const hintEl = $('distance-hint');
  hintEl.textContent = 'Menghitung jarak…';
  try {
    const url = `${OSRM_ROUTE}${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.code !== 'Ok' || !json.routes?.length) throw new Error('Rute tidak ditemukan');

    const km = Math.round((json.routes[0].distance / 1000) * 10) / 10;
    state.lastAutoKm = km;
    const kmText = formatKm(km);
    const distEl = $('f-distance');
    const isEmpty = !distEl.value.trim();
    const isStaleAuto = distEl.dataset.auto === '1';

    if (isEmpty || isStaleAuto) {
      distEl.value = kmText;
      distEl.dataset.auto = '1';
      hintEl.innerHTML = `✓ Jarak dihitung otomatis: ${kmText} KM`;
    } else {
      hintEl.innerHTML = `Jarak rute: <strong>${kmText} KM</strong> · <button type="button" id="btn-use-auto-km" class="link-btn">pakai</button>`;
    }
  } catch (e) {
    console.warn('recalcDistance:', e);
    hintEl.textContent = 'Gagal hitung jarak otomatis — isi manual.';
  }
}

function applyAutoKm() {
  if (state.lastAutoKm == null) return;
  const distEl = $('f-distance');
  distEl.value = formatKm(state.lastAutoKm);
  distEl.dataset.auto = '1';
  $('distance-hint').innerHTML = `✓ Jarak dihitung otomatis: ${formatKm(state.lastAutoKm)} KM`;
}

// ---- map picker: tap a field's 🗺️ button to open ------------------------
// Gojek-style — a pin fixed at screen-center, the map pans underneath it,
// and the address is reverse-geocoded whenever the map stops moving.

function ensurePickerMap() {
  if (state.picker.map) return;
  state.picker.map = L.map('mappicker-map', { zoomControl: true }).setView(DEFAULT_MAP_CENTER, 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(state.picker.map);
  state.picker.map.on('moveend', () => reverseGeocodeCenter());
}

function openMapPicker(target) {
  state.picker.target = target;
  $('mappicker-title').textContent = target === 'from' ? 'Lokasi Asal' : 'Lokasi Tujuan';
  $('mp-search').value = '';
  hideSearchResults();
  $('view-mappicker').hidden = false;

  ensurePickerMap();
  setTimeout(() => state.picker.map.invalidateSize(), 50);

  const existing = state.points[target];
  if (existing) {
    state.picker.center = { lat: existing.lat, lng: existing.lng };
    setPickerAddress(existing.label);
    state.picker.map.setView([existing.lat, existing.lng], 16);
  } else if (target === 'from' && navigator.geolocation) {
    setPickerAddress('Mencari lokasi Anda…');
    navigator.geolocation.getCurrentPosition(
      (pos) => state.picker.map.setView([pos.coords.latitude, pos.coords.longitude], 16),
      () => reverseGeocodeCenter(),
      { timeout: 6000 }
    );
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
  $(target === 'from' ? 'f-from' : 'f-to').value = state.picker.address;
  closeMapPicker();
  recalcDistance();
}

function setPickerAddress(text) {
  state.picker.address = text;
  $('mp-address').textContent = text;
}

async function reverseGeocodeCenter() {
  const map = state.picker.map;
  const c = map.getCenter();
  state.picker.center = { lat: c.lat, lng: c.lng };
  setPickerAddress('Mencari alamat…');
  try {
    // Photon's public instance only supports lang=default/de/en/fr — "id" is
    // rejected with a 400, so leave it unset (it still returns local names).
    const url = `${PHOTON_REVERSE}?lon=${c.lng}&lat=${c.lat}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Photon reverse ${res.status}`);
    const json = await res.json();
    const label = formatPhotonFeature(json.features?.[0]) || `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
    setPickerAddress(label);
  } catch (e) {
    console.warn('reverseGeocodeCenter:', e);
    setPickerAddress(`${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} (nama alamat tidak tersedia)`);
  }
}

function formatPhotonFeature(f) {
  if (!f) return '';
  const p = f.properties || {};
  return [p.name, p.street, p.district || p.city, p.state].filter(Boolean).join(', ');
}

// ---- place search (Photon) ------------------------------------------------

let searchDebounce;
function onSearchInput(e) {
  clearTimeout(searchDebounce);
  const q = e.target.value.trim();
  if (q.length < 3) return hideSearchResults();
  searchDebounce = setTimeout(() => runSearch(q), 400);
}

async function runSearch(q) {
  const el = $('mp-search-results');
  el.innerHTML = '<div class="mp-search-result muted">Mencari…</div>';
  el.hidden = false;
  try {
    const url = `${PHOTON_SEARCH}?q=${encodeURIComponent(q)}&limit=6`;
    const res = await fetch(url);
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
  if (!results.length) {
    el.innerHTML = '<div class="mp-search-result muted">Tidak ditemukan.</div>';
    el.hidden = false;
    return;
  }
  el.innerHTML = results
    .map((f, i) => `<div class="mp-search-result" data-idx="${i}">${escapeHtml(formatPhotonFeature(f) || 'Lokasi')}</div>`)
    .join('');
  el.hidden = false;
}

function hideSearchResults() {
  $('mp-search-results').hidden = true;
}

function selectSearchResult(feature) {
  if (!feature) return;
  hideSearchResults();
  $('mp-search').value = '';
  const [lng, lat] = feature.geometry.coordinates;
  state.picker.map.setView([lat, lng], 16); // moveend fires reverseGeocodeCenter
}

// ---- favorites: a separate saved-address list, not tied to history ------

async function openFavorites(target) {
  state.favTarget = target;
  state.favError = null;
  $('fav-modal').hidden = false;
  $('btn-fav-save-current').hidden = !state.points[target];
  $('fav-list').innerHTML = '<p class="fav-empty">Memuat…</p>';
  await loadFavorites();
  renderFavorites();
}

function closeFavorites() {
  $('fav-modal').hidden = true;
  state.favTarget = null;
}

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
    return;
  }
  state.favError = null;
  state.favorites = data || [];
}

function renderFavorites() {
  const el = $('fav-list');

  if (state.favError) {
    el.innerHTML = `<p class="fav-empty">Gagal memuat: ${escapeHtml(state.favError)}</p>`;
    return;
  }

  if (!state.favorites.length) {
    // Explain *why* the save button below might not be visible either —
    // without this, an empty sheet with no save button looks broken rather
    // than "pick a location first".
    el.innerHTML = state.points[state.favTarget]
      ? '<p class="fav-empty">Belum ada alamat favorit. Simpan lokasi yang sudah dipilih lewat tombol di bawah.</p>'
      : '<p class="fav-empty">Belum ada alamat favorit.<br>Pilih lokasi dulu lewat 🗺️, baru bisa disimpan ke sini.</p>';
    return;
  }

  el.innerHTML = state.favorites
    .map(
      (f) => `
      <div class="fav-item" data-id="${f.id}">
        <span class="fav-item-text">${escapeHtml(f.address)}</span>
        <button type="button" class="fav-item-del" data-del="${f.id}">🗑️</button>
      </div>`
    )
    .join('');
}

function useFavorite(fav) {
  const target = state.favTarget;
  if (!target || !fav) return;
  state.points[target] = { lat: fav.lat, lng: fav.lng, label: fav.address };
  $(target === 'from' ? 'f-from' : 'f-to').value = fav.address;
  closeFavorites();
  recalcDistance();
}

async function saveFavoriteFromField() {
  const target = state.favTarget;
  const point = state.points[target];
  if (!point) return;
  const { error } = await supabase.from('courier_favorite_addresses').insert({
    user_email: state.user.email,
    address: point.label,
    lat: point.lat,
    lng: point.lng,
  });
  if (error) return showBanner('Gagal simpan favorit: ' + error.message);
  $('btn-fav-save-current').hidden = true;
  await loadFavorites();
  renderFavorites();
}

async function deleteFavorite(id) {
  const { error } = await supabase.from('courier_favorite_addresses').delete().eq('id', id);
  if (!error) {
    state.favorites = state.favorites.filter((f) => f.id !== id);
    renderFavorites();
  }
}

// ---- wiring ---------------------------------------------------------------

function init() {
  $('btn-google-login').addEventListener('click', handleGoogleLogin);
  $('btn-logout').addEventListener('click', logout);
  $('btn-start').addEventListener('click', startTrip);
  $('btn-finish').addEventListener('click', finishTrip);

  wireLocationField('f-from', 'from');
  wireLocationField('f-to', 'to');
  $('f-distance').addEventListener('input', () => delete $('f-distance').dataset.auto);
  $('distance-hint').addEventListener('click', (e) => {
    if (e.target.id === 'btn-use-auto-km') applyAutoKm();
  });

  document.querySelectorAll('[data-pick]').forEach((btn) => btn.addEventListener('click', () => openMapPicker(btn.dataset.pick)));
  document.querySelectorAll('[data-fav]').forEach((btn) => btn.addEventListener('click', () => openFavorites(btn.dataset.fav)));

  $('btn-mappicker-cancel').addEventListener('click', closeMapPicker);
  $('btn-mappicker-confirm').addEventListener('click', confirmMapPicker);
  $('mp-search').addEventListener('input', onSearchInput);
  $('mp-search-results').addEventListener('click', (e) => {
    const item = e.target.closest('[data-idx]');
    if (item) selectSearchResult(state.picker.searchResults[Number(item.dataset.idx)]);
  });

  $('btn-fav-close').addEventListener('click', closeFavorites);
  $('btn-fav-save-current').addEventListener('click', saveFavoriteFromField);
  $('fav-modal').addEventListener('click', (e) => {
    if (e.target.id === 'fav-modal') closeFavorites();
  });
  $('fav-list').addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) {
      e.stopPropagation();
      deleteFavorite(Number(delBtn.dataset.del));
      return;
    }
    const item = e.target.closest('.fav-item');
    if (item) useFavorite(state.favorites.find((f) => String(f.id) === item.dataset.id));
  });

  App?.addListener('appUrlOpen', ({ url }) => handleDeepLink(url));

  // Resume tracking / trip state whenever the app comes back to the
  // foreground (e.g. reopened after Android killed the process).
  App?.addListener('resume', () => {
    if (state.user) loadState();
  });

  // Registering this listener suppresses Android's default back-button
  // behaviour, so we own it: close whichever overlay is open, else exit.
  App?.addListener('backButton', () => {
    if (!$('mp-search-results').hidden) return hideSearchResults();
    if (!$('view-mappicker').hidden) return closeMapPicker();
    if (!$('fav-modal').hidden) return closeFavorites();
    App.exitApp();
  });

  onAuthReady();
}

document.addEventListener('DOMContentLoaded', init);
