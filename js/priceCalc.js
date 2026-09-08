// ============================================================================
// priceCalc.js — evaluates the admin-defined price formulas, plus the Settings
// page that edits them (and the courier per-km rate).
//
// Formulas are arbitrary JS bodies stored in app_settings. Only an admin can
// write them (RLS), and they only ever run in the admin's own browser, so this
// is acceptable — but every evaluation is wrapped so a bad formula can't take
// the page down.
// ============================================================================

import { DB } from './db.js';
import { CONFIG } from './config.js';
import { showToast, confirmModal } from './ui.js';
import { formatCurrency } from './utils.js';

export const PriceCalc = {
  _online: null,
  _offline: null,
  _rate: CONFIG.DEFAULT_COURIER_RATE_PER_KM,

  async loadFormulas() {
    const settings = await DB.getSettings();
    for (const s of settings || []) {
      if (s.setting_key === 'formula_online') this._online = s.setting_value;
      else if (s.setting_key === 'formula_offline') this._offline = s.setting_value;
      else if (s.setting_key === 'courier_rate_per_km') {
        const n = parseFloat(s.setting_value);
        if (!isNaN(n) && n > 0) this._rate = n;
      }
    }
  },

  courierRatePerKm() {
    return this._rate || CONFIG.DEFAULT_COURIER_RATE_PER_KM;
  },

  _run(body, h) {
    if (!h || h <= 0) return 0;
    if (!body) return 0;
    try {
      const result = new Function('h', body)(h);
      return Number.isFinite(result) ? result : 0;
    } catch (e) {
      console.error('formula error:', e);
      return 0;
    }
  },

  hargaOnline(h) {
    return this._run(this._online, h);
  },
  hargaOffline(h) {
    return this._run(this._offline, h);
  },
};

export const Settings = {
  _wired: false,

  async render() {
    await PriceCalc.loadFormulas();

    const online = document.getElementById('input-formula-online');
    const offline = document.getElementById('input-formula-offline');
    const rate = document.getElementById('input-courier-rate');
    const preview = document.getElementById('formula-preview');
    const previewInput = document.getElementById('formula-preview-input');

    online.value = PriceCalc._online || '';
    offline.value = PriceCalc._offline || '';
    if (rate) rate.value = PriceCalc.courierRatePerKm();

    const runPreview = () => {
      if (!preview) return;
      const h = parseFloat(previewInput.value) || 0;
      let on = 0;
      let off = 0;
      try {
        on = new Function('h', online.value)(h);
      } catch {}
      try {
        off = new Function('h', offline.value)(h);
      } catch {}
      preview.innerHTML =
        `Distribusi <strong>${formatCurrency(h)}</strong> → Online <strong>${formatCurrency(on || 0)}</strong> · Offline <strong>${formatCurrency(off || 0)}</strong>`;
    };
    if (!this._wired) {
      this._wired = true;
      previewInput?.addEventListener('input', runPreview);
      online.addEventListener('input', runPreview);
      offline.addEventListener('input', runPreview);
    }
    runPreview();

    const btn = document.getElementById('btn-save-formulas');
    // Replace to drop any listener from a previous render.
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: 'Ubah rumus harga?',
        message:
          'Rumus baru langsung dipakai untuk semua perhitungan Harga Online / Offline. Pastikan sudah dicek di pratinjau.',
        confirmText: 'Ya, simpan',
        danger: true,
        countdown: 3,
      });
      if (!ok) return;

      fresh.disabled = true;
      fresh.textContent = 'Menyimpan…';
      try {
        await DB.saveSetting('formula_online', online.value);
        await DB.saveSetting('formula_offline', offline.value);
        if (rate) await DB.saveSetting('courier_rate_per_km', String(parseFloat(rate.value) || CONFIG.DEFAULT_COURIER_RATE_PER_KM));
        await PriceCalc.loadFormulas();
        showToast('Pengaturan berhasil disimpan', 'success');
      } catch (e) {
        showToast('Gagal menyimpan: ' + e.message, 'error');
      } finally {
        fresh.disabled = false;
        fresh.textContent = 'Simpan Perubahan';
      }
    });
  },
};
