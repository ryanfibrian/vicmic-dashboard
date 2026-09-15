// ============================================================================
// pages/courier.js — courier trip log: start a trip (running timer), finish it,
// monthly recap of distance / time / commission, plus admin edit / import /
// export. Row actions use event delegation (no inline onclick).
// ============================================================================

import { supabaseClient } from '../config.js';
import { Auth } from '../auth.js';
import { PriceCalc } from '../priceCalc.js';
import {
  formatCurrency,
  formatDuration,
  parseDecimalId,
  escapeHtml,
  monthKey,
} from '../utils.js';
import { showToast, confirmModal, showModal, hideModal, BTN_SPINNER } from '../ui.js';

const COL_COUNT = 10;

export const Courier = {
  _timerInterval: null,
  _wired: false,
  _routeMap: new Map(), // normalized "locA__locB" -> { km, count }
  _locations: [],
  _routesLoaded: false,

  // GPS tracking (browser Geolocation API — free, no key) + admin live map.
  _geoWatchId: null,
  _activeTripId: null,
  _lastPingAt: 0,
  _geoErrorShown: false,
  _mapRefreshInterval: null,
  _map: null,
  _mapMarkers: new Map(), // trip id -> Leaflet marker
  _hadMapMarkers: false,

  init() {
    if (this._wired) return;
    this._wired = true;

    document.getElementById('courier-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveLog();
    });
    document.getElementById('edit-courier-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveEditLog();
    });

    // Route memory: suggest a known distance once "from" + "to" match a past
    // trip, so a courier doesn't have to remember/re-type the same KM every
    // time. Wired for both the start-trip form and the admin edit modal.
    ['courier', 'edit-courier'].forEach((prefix) => {
      const fromEl = document.getElementById(`${prefix}-from`);
      const toEl = document.getElementById(`${prefix}-to`);
      const distEl = document.getElementById(`${prefix}-distance`);
      fromEl?.addEventListener('input', () => this.suggestDistance(prefix));
      toEl?.addEventListener('input', () => this.suggestDistance(prefix));
      // Once the courier types their own number, stop treating it as an
      // auto-filled value that a later from/to edit is free to overwrite.
      distEl?.addEventListener('input', () => delete distEl.dataset.auto);
    });
    document.getElementById('courier-form').addEventListener('click', (e) => {
      if (e.target.closest('[data-use-suggested]')) this.applySuggestedDistance('courier');
    });
    document.getElementById('edit-courier-form').addEventListener('click', (e) => {
      if (e.target.closest('[data-use-suggested]')) this.applySuggestedDistance('edit-courier');
    });

    // Static header actions (admin).
    document.getElementById('btn-courier-export')?.addEventListener('click', () => this.exportToExcel());
    document.getElementById('btn-courier-template')?.addEventListener('click', () => this.downloadTemplate());
    document.getElementById('btn-courier-import')?.addEventListener('click', () =>
      document.getElementById('import-courier-logs').click()
    );
    document.getElementById('import-courier-logs')?.addEventListener('change', (e) => this.importExcel(e));

    // Edit-modal close buttons.
    document.querySelectorAll('[data-close-edit-courier]').forEach((el) =>
      el.addEventListener('click', () => this.closeEditModal())
    );

    // Delegated row actions.
    document.getElementById('courier-table-body').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.action === 'finish') this.finishLog(id);
      else if (btn.dataset.action === 'edit') this.editLog(id);
      else if (btn.dataset.action === 'track') this.viewTrack(id);
      else if (btn.dataset.action === 'delete') this.deleteLog(id);
    });

    if (this._timerInterval) clearInterval(this._timerInterval);
    this._timerInterval = setInterval(() => this.tickTimers(), 1000);

    if (this._mapRefreshInterval) clearInterval(this._mapRefreshInterval);
    this._mapRefreshInterval = setInterval(() => this.refreshMapIfVisible(), 15000);
  },

  tickTimers() {
    const now = Date.now();
    document.querySelectorAll('.courier-timer[data-start]').forEach((el) => {
      const diff = now - new Date(el.dataset.start).getTime();
      if (diff >= 0) el.textContent = formatDuration(diff);
    });
  },

  // ---- GPS tracking: browser Geolocation API, free, no key ---------------
  // Only runs while a trip is "sedang jalan", and only pings while this
  // device's tab is open/foregrounded — a browser can't reliably track in
  // the background the way a native app could. Writes straight into the
  // trip's own courier_logs row (last_lat/last_lng/last_ping_at), which the
  // existing update policy already allows for the trip's owner or an admin.

  startTracking(tripId) {
    if (!navigator.geolocation) {
      showToast('Perangkat/browser ini tidak mendukung GPS — posisi tidak akan terlihat admin.', 'warning');
      return;
    }
    this.stopTracking();
    this._activeTripId = tripId;
    this._lastPingAt = 0;
    this._geoErrorShown = false;
    this._geoWatchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePosition(tripId, pos),
      (err) => {
        console.warn('geolocation:', err.message);
        if (!this._geoErrorShown) {
          this._geoErrorShown = true;
          showToast('Lokasi GPS tidak tersedia: ' + err.message, 'warning');
        }
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
  },

  stopTracking() {
    if (this._geoWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this._geoWatchId);
    }
    this._geoWatchId = null;
    this._activeTripId = null;
  },

  async handlePosition(tripId, pos) {
    const now = Date.now();
    if (now - this._lastPingAt < 15000) return; // throttle writes to ~1/15s
    this._lastPingAt = now;
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const { error } = await supabaseClient
      .from('courier_logs')
      .update({ last_lat: lat, last_lng: lng, last_ping_at: new Date().toISOString() })
      .eq('id', tripId);
    if (error) console.warn('position ping:', error.message);

    // Breadcrumb trail for the admin "Lihat Rute" button — separate table
    // (migration 008) from the live-position columns above, since this one
    // keeps every point instead of just the latest.
    const { error: trackErr } = await supabaseClient
      .from('courier_positions')
      .insert({ trip_id: tripId, user_email: Auth.currentUser.email, lat, lng });
    if (trackErr) console.warn('position track:', trackErr.message);
  },

  // Resumes tracking after a page reload if this user still has a trip
  // running, and stops it if that trip isn't running anymore.
  syncTrackingWithMyTrip(rows) {
    const mine = rows.find((l) => l.status === 'sedang jalan' && l.user_email === Auth.currentUser?.email);
    if (mine && this._activeTripId !== mine.id) this.startTracking(mine.id);
    else if (!mine && this._activeTripId) this.stopTracking();
  },

  // ---- admin: live map of couriers currently "sedang jalan" -------------

  initMap() {
    if (this._map || !window.L) return;
    const el = document.getElementById('courier-map');
    if (!el) return;
    this._map = L.map(el, { scrollWheelZoom: false }).setView([-6.25, 106.7], 11); // Jabodetabek default
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this._map);
  },

  async refreshMapIfVisible() {
    if (!Auth.isAdmin() || !this._map) return;
    const page = document.getElementById('page-courier');
    if (!page?.classList.contains('active')) return;

    const { data, error } = await supabaseClient
      .from('courier_logs')
      .select('id, user_email, status, last_lat, last_lng')
      .eq('status', 'sedang jalan');
    if (error) return;
    this.renderMapMarkers(data || []);
  },

  renderMapMarkers(rows) {
    if (!this._map || !window.L) return;
    const active = rows.filter((r) => r.status === 'sedang jalan' && r.last_lat != null && r.last_lng != null);

    const seen = new Set();
    for (const r of active) {
      const id = String(r.id);
      seen.add(id);
      const label = escapeHtml((r.user_email || '').split('@')[0]);
      let marker = this._mapMarkers.get(id);
      if (marker) {
        marker.setLatLng([r.last_lat, r.last_lng]);
      } else {
        const icon = L.divIcon({
          className: 'courier-map-pin',
          html: `<span class="pin-dot"></span><span class="pin-label">${label}</span>`,
          iconSize: [0, 0],
          iconAnchor: [8, 8],
        });
        marker = L.marker([r.last_lat, r.last_lng], { icon }).addTo(this._map);
        this._mapMarkers.set(id, marker);
      }
    }
    for (const [id, marker] of this._mapMarkers) {
      if (!seen.has(id)) {
        marker.remove();
        this._mapMarkers.delete(id);
      }
    }

    const statusEl = document.getElementById('courier-map-status');
    if (statusEl) {
      statusEl.textContent = active.length ? `${active.length} kurir sedang jalan` : 'Tidak ada kurir yang sedang jalan';
    }

    if (active.length && !this._hadMapMarkers) {
      this._map.fitBounds(
        L.latLngBounds(active.map((r) => [r.last_lat, r.last_lng])),
        { padding: [40, 40], maxZoom: 15 }
      );
    }
    this._hadMapMarkers = active.length > 0;
  },

  // Draws the actual GPS breadcrumb trail recorded for one trip (migration
  // 008, courier_positions) — not a guessed start->end route, the real path.
  async viewTrack(id) {
    const { data, error } = await supabaseClient
      .from('courier_positions')
      .select('lat, lng, recorded_at')
      .eq('trip_id', id)
      .order('recorded_at', { ascending: true });

    if (error) return showToast('Gagal memuat rute: ' + error.message, 'error');
    if (!data || data.length < 2) {
      return showToast('Belum ada cukup data GPS untuk rute perjalanan ini.', 'warning');
    }

    showModal(
      'Rute Perjalanan',
      `<div id="track-map" class="track-map"></div>
       <p class="track-meta">${data.length} titik GPS tercatat</p>`,
      [{ text: 'Tutup', class: 'btn-secondary', onClick: hideModal }]
    );

    setTimeout(() => {
      const el = document.getElementById('track-map');
      if (!el || !window.L) return;
      const latlngs = data.map((p) => [p.lat, p.lng]);

      const map = L.map(el).setView(latlngs[0], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      const line = L.polyline(latlngs, { color: '#16a34a', weight: 5, opacity: 0.9, lineJoin: 'round' }).addTo(map);
      L.circleMarker(latlngs[0], { radius: 7, color: '#fff', weight: 3, fillColor: '#16a34a', fillOpacity: 1 }).addTo(map);
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, color: '#fff', weight: 3, fillColor: '#dc2626', fillOpacity: 1 }).addTo(map);

      map.fitBounds(line.getBounds(), { padding: [30, 30] });
      setTimeout(() => map.invalidateSize(), 50);
    }, 50);
  },

  // ---- route memory: reuse past trips instead of retyping the KM ---------
  // Builds an in-memory map straight from the courier's own history (RLS
  // already scopes courier_logs to their rows, or all of them for admin) —
  // no new table, no external maps API, just what's already recorded.

  normLoc(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  },

  routeKey(a, b) {
    return [this.normLoc(a), this.normLoc(b)].sort().join('__');
  },

  async loadRouteMemory() {
    const { data, error } = await supabaseClient
      .from('courier_logs')
      .select('from_location, to_location, distance_km, date')
      .order('date', { ascending: false })
      .limit(1000);
    if (error || !data) return;

    const freq = new Map(); // routeKey -> Map(distance -> occurrences)
    const locs = new Map(); // normalized -> nicest original casing seen

    for (const r of data) {
      const from = r.from_location;
      const to = r.to_location;
      const km = Number(r.distance_km);
      if (!from || !to || !isFinite(km) || km <= 0) continue;

      const key = this.routeKey(from, to);
      if (!freq.has(key)) freq.set(key, new Map());
      const m = freq.get(key);
      m.set(km, (m.get(km) || 0) + 1);

      for (const loc of [from, to]) {
        const n = this.normLoc(loc);
        if (n && !locs.has(n)) locs.set(n, loc.trim());
      }
    }

    this._routeMap = new Map();
    for (const [key, m] of freq) {
      let bestKm = null;
      let bestCount = 0;
      let total = 0;
      for (const [km, count] of m) {
        total += count;
        if (count > bestCount) {
          bestKm = km;
          bestCount = count;
        }
      }
      this._routeMap.set(key, { km: bestKm, count: total });
    }
    this._locations = [...locs.values()].sort((a, b) => a.localeCompare(b, 'id'));
    this._routesLoaded = true;
    this.renderLocationDatalist();
  },

  renderLocationDatalist() {
    const dl = document.getElementById('courier-location-list');
    if (!dl) return;
    dl.innerHTML = this._locations.map((l) => `<option value="${escapeHtml(l)}">`).join('');
  },

  // Formats a plain number the way the KM inputs expect it back
  // (parseDecimalId reads "," as the decimal separator, "." as a thousands one).
  formatKmInput(n) {
    return String(n).replace('.', ',');
  },

  suggestDistance(prefix) {
    const fromEl = document.getElementById(`${prefix}-from`);
    const toEl = document.getElementById(`${prefix}-to`);
    const distEl = document.getElementById(`${prefix}-distance`);
    const hintEl = document.getElementById(`${prefix}-distance-hint`);
    if (!fromEl || !toEl || !distEl || !hintEl) return;

    const from = fromEl.value.trim();
    const to = toEl.value.trim();
    if (!from || !to) {
      hintEl.innerHTML = '';
      return;
    }

    const known = this._routeMap.get(this.routeKey(from, to));
    if (!known) {
      hintEl.innerHTML = '';
      return;
    }

    const kmText = this.formatKmInput(known.km);
    const isEmpty = !distEl.value.trim();
    const isStaleAuto = distEl.dataset.auto === '1' && parseDecimalId(distEl.value) !== known.km;

    if (isEmpty || isStaleAuto) {
      distEl.value = kmText;
      distEl.dataset.auto = '1';
      hintEl.innerHTML = `<span class="hint-ok">✓ ${kmText} KM otomatis terisi dari riwayat (rute ini sudah dipakai ${known.count}×)</span>`;
    } else {
      hintEl.innerHTML = `<span class="hint-info">Riwayat rute ini: <strong>${kmText} KM</strong> (dipakai ${known.count}×) ·
        <button type="button" class="route-hint-link" data-use-suggested="1">pakai angka ini</button></span>`;
    }
  },

  applySuggestedDistance(prefix) {
    const fromEl = document.getElementById(`${prefix}-from`);
    const toEl = document.getElementById(`${prefix}-to`);
    const distEl = document.getElementById(`${prefix}-distance`);
    const known = this._routeMap.get(this.routeKey(fromEl.value.trim(), toEl.value.trim()));
    if (!known) return;
    distEl.value = this.formatKmInput(known.km);
    distEl.dataset.auto = '1';
    this.suggestDistance(prefix);
  },

  async saveLog() {
    const btn = document.querySelector('#courier-form button[type="submit"]');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${BTN_SPINNER} Menyimpan…`;

    try {
      const { data: active, error: checkErr } = await supabaseClient
        .from('courier_logs')
        .select('id')
        .eq('user_email', Auth.currentUser.email)
        .eq('status', 'sedang jalan');
      if (checkErr) throw checkErr;
      if (active?.length) {
        showToast('Masih ada perjalanan yang belum diselesaikan.', 'warning');
        return;
      }

      const distanceKm = parseDecimalId(document.getElementById('courier-distance').value);
      if (isNaN(distanceKm) || distanceKm <= 0) {
        showToast('Jarak KM tidak valid', 'error');
        return;
      }

      const now = new Date();
      const { data: inserted, error } = await supabaseClient
        .from('courier_logs')
        .insert([
          {
            user_email: Auth.currentUser.email,
            date: now.toISOString().split('T')[0],
            time: now.toTimeString().substring(0, 5),
            from_location: document.getElementById('courier-from').value.trim(),
            to_location: document.getElementById('courier-to').value.trim(),
            distance_km: distanceKm,
            amount_rp: Math.round(distanceKm * PriceCalc.courierRatePerKm()),
            status: 'sedang jalan',
            start_time: now.toISOString(),
          },
        ])
        .select('id')
        .maybeSingle();
      if (error) throw error;

      showToast('Perjalanan dimulai', 'success');
      document.getElementById('courier-form').reset();
      delete document.getElementById('courier-distance').dataset.auto;
      document.getElementById('courier-distance-hint').innerHTML = '';
      if (inserted?.id) this.startTracking(inserted.id);
      this.loadLogs();
      this.loadRouteMemory();
    } catch (e) {
      console.error('saveLog:', e);
      showToast('Gagal memulai perjalanan: ' + (e.message || e), 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  },

  async finishLog(id) {
    const ok = await confirmModal({ title: 'Selesaikan perjalanan ini?', confirmText: 'Selesai' });
    if (!ok) return;
    const { error } = await supabaseClient
      .from('courier_logs')
      .update({ status: 'selesai', end_time: new Date().toISOString() })
      .eq('id', id);
    if (error) showToast('Gagal menyelesaikan perjalanan', 'error');
    else {
      if (String(id) === String(this._activeTripId)) this.stopTracking();
      showToast('Perjalanan selesai', 'success');
      this.loadLogs();
    }
  },

  async loadLogs() {
    const tbody = document.getElementById('courier-table-body');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="${COL_COUNT}" class="cell-empty"><span class="spinner"></span> Memuat…</td></tr>`;

    if (!this._routesLoaded) this.loadRouteMemory();

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    const monthStartKey = startOfMonth.toISOString().split('T')[0];

    let query = supabaseClient
      .from('courier_logs')
      .select('*')
      .gte('date', monthStartKey)
      .order('start_time', { ascending: false });
    if (!Auth.isAdmin()) query = query.eq('user_email', Auth.currentUser.email);

    const { data, error } = await query;
    if (error) {
      tbody.innerHTML = `<tr><td colspan="${COL_COUNT}" class="cell-empty err">Gagal memuat data</td></tr>`;
      return;
    }

    this.syncTrackingWithMyTrip(data);

    if (Auth.isAdmin()) {
      this.populateAdminFilter(data);
      if (!this._map) this.initMap();
      else this._map.invalidateSize();
      this.renderMapMarkers(data);
    }

    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="${COL_COUNT}" class="cell-empty">Belum ada log perjalanan bulan ini</td></tr>`;
      this.updateRecap(0, 0, 0);
      return;
    }

    let totalKm = 0;
    let totalRp = 0;
    let totalMs = 0;

    tbody.innerHTML = data
      .map((log) => {
        const done = log.status === 'selesai' || !log.status;
        let durationMs = 0;
        if (done) {
          totalKm += log.distance_km;
          totalRp += log.amount_rp;
          if (log.start_time && log.end_time) {
            const m = new Date(log.end_time) - new Date(log.start_time);
            if (m > 0) {
              durationMs = m;
              totalMs += m;
            }
          }
        }

        const t = (v) =>
          v ? new Date(v).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—';
        const dateStr = log.date ? new Date(log.date).toLocaleDateString('id-ID') : '—';

        const running = log.status === 'sedang jalan';
        const statusHtml = running
          ? '<span class="tag tag-warning">Sedang Jalan</span>'
          : '<span class="tag tag-success">Selesai</span>';
        const timerHtml = running
          ? `<span class="courier-timer mono" data-start="${escapeHtml(log.start_time)}">00:00:00</span>`
          : `<span class="mono text-muted">${formatDuration(durationMs)}</span>`;

        let actions = '';
        if (running && Auth.currentUser.email === log.user_email)
          actions += `<button class="btn btn-sm btn-primary" data-action="finish" data-id="${log.id}">Selesai</button>`;
        if (Auth.isAdmin()) {
          actions += `<button class="btn btn-sm btn-secondary" data-action="track" data-id="${log.id}" title="Lihat rute GPS perjalanan ini">🛣️ Rute</button>`;
          actions += `<button class="btn btn-sm btn-secondary" data-action="edit" data-id="${log.id}">Edit</button>`;
        }
        actions += `<button class="btn btn-sm btn-danger" data-action="delete" data-id="${log.id}">Hapus</button>`;

        return `
        <tr data-email="${escapeHtml(log.user_email)}" data-km="${log.distance_km}" data-rp="${log.amount_rp}" data-status="${escapeHtml(log.status || 'selesai')}" data-ms="${durationMs}">
          <td>${dateStr}${Auth.isAdmin() ? `<br><small class="text-accent">${escapeHtml(log.user_email)}</small>` : ''}</td>
          <td>${t(log.start_time)}</td>
          <td>${t(log.end_time)}</td>
          <td class="ellipsis" title="${escapeHtml(log.from_location)}">${escapeHtml(log.from_location)}</td>
          <td class="ellipsis" title="${escapeHtml(log.to_location)}">${escapeHtml(log.to_location)}</td>
          <td class="num">${log.distance_km} KM</td>
          <td>${statusHtml}</td>
          <td>${timerHtml}</td>
          <td class="num text-success">${done ? formatCurrency(log.amount_rp) : '—'}</td>
          <td class="table-actions">${actions}</td>
        </tr>`;
      })
      .join('');

    const filterEl = document.getElementById('filter-courier-user');
    if (Auth.isAdmin() && filterEl?.value) {
      this.applyAdminFilter();
    } else {
      this.updateRecap(totalKm, totalRp, totalMs);
    }
  },

  populateAdminFilter(data) {
    const filterEl = document.getElementById('filter-courier-user');
    const wrapper = document.getElementById('admin-courier-filter-wrapper');
    if (!filterEl) return;
    if (wrapper) wrapper.hidden = false;
    const current = filterEl.value;
    const emails = [...new Set(data.map((l) => l.user_email))].sort();
    filterEl.innerHTML =
      '<option value="">— Semua Kurir —</option>' +
      emails.map((e) => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
    filterEl.value = current;
    filterEl.onchange = () => this.applyAdminFilter();
  },

  applyAdminFilter() {
    const selected = document.getElementById('filter-courier-user').value;
    let km = 0;
    let rp = 0;
    let ms = 0;
    document.querySelectorAll('#courier-table-body tr').forEach((row) => {
      if (!row.dataset.email) return;
      const match = !selected || row.dataset.email === selected;
      row.hidden = !match;
      if (match && (row.dataset.status === 'selesai' || !row.dataset.status)) {
        km += parseFloat(row.dataset.km || 0);
        rp += parseInt(row.dataset.rp || 0, 10);
        ms += parseInt(row.dataset.ms || 0, 10);
      }
    });
    this.updateRecap(km, rp, ms);
  },

  updateRecap(km, rp, ms) {
    document.getElementById('rekap-jarak').textContent = `${Number(km).toFixed(2)} KM`;
    document.getElementById('rekap-komisi').textContent = formatCurrency(rp);
    const w = document.getElementById('rekap-waktu');
    if (w) w.textContent = formatDuration(ms);
  },

  async editLog(id) {
    const { data, error } = await supabaseClient.from('courier_logs').select('*').eq('id', id).single();
    if (error || !data) return showToast('Data tidak ditemukan', 'error');
    document.getElementById('edit-courier-id').value = data.id;
    document.getElementById('edit-courier-from').value = data.from_location;
    document.getElementById('edit-courier-to').value = data.to_location;
    const distEl = document.getElementById('edit-courier-distance');
    distEl.value = this.formatKmInput(data.distance_km);
    delete distEl.dataset.auto; // this is the real saved value, not a suggestion
    document.getElementById('edit-courier-distance-hint').innerHTML = '';
    document.getElementById('edit-courier-modal').classList.add('show');
  },

  closeEditModal() {
    document.getElementById('edit-courier-modal').classList.remove('show');
  },

  async saveEditLog() {
    try {
      const id = document.getElementById('edit-courier-id').value;
      const dist = parseDecimalId(document.getElementById('edit-courier-distance').value);
      if (isNaN(dist) || dist <= 0) return showToast('Jarak KM tidak valid', 'error');

      const { error } = await supabaseClient
        .from('courier_logs')
        .update({
          from_location: document.getElementById('edit-courier-from').value.trim(),
          to_location: document.getElementById('edit-courier-to').value.trim(),
          distance_km: dist,
          amount_rp: Math.round(dist * PriceCalc.courierRatePerKm()),
        })
        .eq('id', id);
      if (error) throw error;

      showToast('Perubahan disimpan', 'success');
      this.closeEditModal();
      this.loadLogs();
    } catch (e) {
      console.error('saveEditLog:', e);
      showToast('Gagal menyimpan perubahan', 'error');
    }
  },

  async deleteLog(id) {
    const ok = await confirmModal({
      title: 'Hapus log perjalanan?',
      message: 'Data tidak bisa dikembalikan.',
      confirmText: 'Hapus',
      danger: true,
      countdown: 2,
    });
    if (!ok) return;
    const { error } = await supabaseClient.from('courier_logs').delete().eq('id', id);
    if (error) showToast('Gagal menghapus log', 'error');
    else {
      showToast('Log terhapus', 'success');
      this.loadLogs();
    }
  },

  downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet([
      {
        Timestamp: '2026-07-21 09:00:00',
        'Email address': 'kurir@example.com',
        'Jam berangkat': '09:00',
        'Jam Tiba': '10:30',
        Dari: 'Serpong',
        Ke: 'Harco',
        'Jarak (km)': 34,
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Template_Import_Kurir.xlsx');
  },

  exportToExcel() {
    const rows = [...document.querySelectorAll('#courier-table-body tr')].filter((tr) => tr.dataset.email);
    if (!rows.length) return showToast('Tidak ada data untuk diexport', 'error');

    const data = rows.map((tr) => ({
      Date: tr.children[0].textContent.replace(tr.dataset.email, '').trim(),
      'Email Kurir': tr.dataset.email,
      'Start Time': tr.children[1].textContent.trim(),
      'End Time': tr.children[2].textContent.trim(),
      Asal: tr.children[3].textContent.trim(),
      Tujuan: tr.children[4].textContent.trim(),
      'Jarak (KM)': parseFloat(tr.dataset.km || 0),
      Status: tr.dataset.status || '',
      Timer: tr.children[7].textContent.trim(),
      'Komisi (Rp)': parseInt(tr.dataset.rp || 0, 10),
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Riwayat Kurir');
    XLSX.writeFile(wb, `Vicmic_Kurir_${monthKey()}.xlsx`);
  },

  importExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        if (!json.length) return showToast('File Excel kosong', 'error');

        const pick = (row, names) => {
          for (const n of names)
            for (const k of Object.keys(row))
              if (k.toLowerCase().includes(n.toLowerCase())) return row[k];
          return '';
        };
        const toIso = (val, baseDate) => {
          if (!val) return `${baseDate}T00:00:00.000Z`;
          if (typeof val === 'number') {
            const secs = Math.round(val * 86400);
            const pad = (n) => String(n).padStart(2, '0');
            return `${baseDate}T${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}.000Z`;
          }
          const d = new Date(`${baseDate} ${val}`);
          return isNaN(d) ? `${baseDate}T00:00:00.000Z` : d.toISOString();
        };

        const rate = PriceCalc.courierRatePerKm();
        const logs = [];
        for (const row of json) {
          const email = String(pick(row, ['email'])).trim().toLowerCase();
          if (!email) continue;

          const ts = pick(row, ['timestamp', 'tanggal', 'date']);
          let dateStr = new Date().toISOString().split('T')[0];
          if (ts) {
            const d = typeof ts === 'number' ? new Date(Math.round((ts - 25569) * 86400 * 1000)) : new Date(ts);
            if (!isNaN(d)) {
              const pad = (n) => String(n).padStart(2, '0');
              dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            }
          }

          const startIso = toIso(pick(row, ['berangkat', 'start', 'awal']), dateStr);
          const endIso = toIso(pick(row, ['tiba', 'end', 'akhir']), dateStr);
          const dist = parseDecimalId(pick(row, ['jarak', 'km'])) || 0;

          logs.push({
            user_email: email,
            date: dateStr,
            time: startIso.split('T')[1].substring(0, 5),
            from_location: String(pick(row, ['dari', 'asal']) || 'Unknown'),
            to_location: String(pick(row, ['ke', 'tujuan']) || 'Unknown'),
            distance_km: dist,
            amount_rp: Math.round(dist * rate),
            status: 'selesai',
            start_time: startIso,
            end_time: endIso,
          });
        }

        if (!logs.length) return showToast('Tidak ada baris data valid', 'error');
        const ok = await confirmModal({
          title: `Import ${logs.length} baris?`,
          message: 'Data akan digabung ke riwayat yang ada.',
          confirmText: 'Import',
        });
        if (!ok) return;

        showToast('Mengimport…', 'info');
        for (let i = 0; i < logs.length; i += 50) {
          const { error } = await supabaseClient.from('courier_logs').insert(logs.slice(i, i + 50));
          if (error) throw error;
        }
        showToast(`Berhasil import ${logs.length} data`, 'success');
        this.loadLogs();
        this.loadRouteMemory();
      } catch (err) {
        console.error('importExcel:', err);
        showToast('Gagal import: ' + err.message, 'error');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  },
};
