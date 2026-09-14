// ============================================================================
// app.js — Vicmic Kurir. Plain JS, no bundler (same philosophy as the main
// dashboard): Capacitor auto-injects its native bridge, so plugins are read
// straight off window.Capacitor.Plugins rather than imported.
//
// Flow: Google login via Supabase's redirect OAuth (opened in a system
// Custom Tab, not this app's own WebView — Google blocks sign-in inside
// embedded webviews) -> deep link back into the app -> exchange the code for
// a session -> start/finish a trip -> background GPS ping while it runs.
// ============================================================================

const { App, Browser, BackgroundGeolocation } = window.Capacitor?.Plugins || {};
const CFG = window.VICMIC_CONFIG;

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
};

const $ = (id) => document.getElementById(id);

function parseDecimalId(raw) {
  // Same rule as the dashboard: "." is a thousands separator, "," is decimal.
  return parseFloat(String(raw ?? '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
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

// ---- wiring ---------------------------------------------------------------

function init() {
  $('btn-google-login').addEventListener('click', handleGoogleLogin);
  $('btn-logout').addEventListener('click', logout);
  $('btn-start').addEventListener('click', startTrip);
  $('btn-finish').addEventListener('click', finishTrip);

  App?.addListener('appUrlOpen', ({ url }) => handleDeepLink(url));

  // Resume tracking / trip state whenever the app comes back to the
  // foreground (e.g. reopened after Android killed the process).
  App?.addListener('resume', () => {
    if (state.user) loadState();
  });

  onAuthReady();
}

document.addEventListener('DOMContentLoaded', init);
