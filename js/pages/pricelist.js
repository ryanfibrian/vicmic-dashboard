// ============================================================================
// pages/pricelist.js — daily price list as an expandable list (not a wide
// table). Each row shows the full product name (wrapped) plus a strip of
// today's figures, each with a clear delta vs the previous available date.
// Click a row to see the full kemarin → hari ini breakdown and copy actions.
//
// Admin can upload a new day's spreadsheet from here and it shows immediately.
// ============================================================================

import { DB } from '../db.js';
import { Auth } from '../auth.js';
import { PriceCalc } from '../priceCalc.js';
import { ExcelParser } from '../excel.js';
import {
  formatNumber,
  formatCurrency,
  formatDate,
  escapeHtml,
  compareValues,
  isSunday,
  todayKey,
} from '../utils.js';
import { showToast, confirmModal, showModal, hideModal, copyToClipboard, BTN_SPINNER } from '../ui.js';

// Metric definitions, in display order. `cost: true` = hidden from sales until
// they toggle it on.
const METRICS = [
  { key: 'total', label: 'Total', kind: 'stock', prev: 'prevTotal' },
  { key: 'harco', label: 'Harco', kind: 'stock', prev: 'prevHarco' },
  { key: 'serpong', label: 'Serpong', kind: 'stock', prev: 'prevSerpong', serpong: true },
  { key: 'distribusi', label: 'Distribusi', kind: 'money', prev: 'prevDistribusi', cost: true },
  { key: 'hargaOnline', label: 'Online', kind: 'money', prev: 'prevHargaOnline' },
  { key: 'hargaOffline', label: 'Offline', kind: 'money', prev: 'prevHargaOffline' },
  { key: 'srp', label: 'SRP', kind: 'money', prev: null },
];

const SORTS = {
  no: (a, b) => a.no - b.no,
  deskripsi: (a, b) => compareValues(a.deskripsi, b.deskripsi, 'text'),
  total: (a, b) => (b.total || 0) - (a.total || 0),
  'total-asc': (a, b) => (a.total || 0) - (b.total || 0),
  distribusi: (a, b) => (b.distribusi || 0) - (a.distribusi || 0),
  change: (a, b) => changeScore(b) - changeScore(a),
};

function changeScore(p) {
  const dPrice = p.prevDistribusi != null ? Math.abs(p.distribusi - p.prevDistribusi) / 1000 : 0;
  const dStock = p.prevTotal != null ? Math.abs((p.total || 0) - p.prevTotal) : 0;
  return dPrice + dStock + (p.isNew ? 1e6 : 0);
}

// Compact currency delta: 1_250_000 -> "1,3jt", 180_000 -> "180rb".
function compactMoney(n) {
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + 'jt';
  if (abs >= 1e3) return Math.round(n / 1e3).toLocaleString('id-ID') + 'rb';
  return formatNumber(n);
}

function deltaChip(cur, prev, kind) {
  if (prev == null || cur === prev) return '';
  const up = cur > prev;
  const diff = Math.abs(cur - prev);
  const text = kind === 'money' ? compactMoney(diff) : formatNumber(diff);
  return `<span class="delta-chip ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${text}</span>`;
}

// ---- smart search -----------------------------------------------------------
// Order-independent, punctuation-insensitive token matching. "acer r5 512"
// matches "NOTEBOOK ACER ASPIRE LITE 14 ... AMD R5-7430U 8GB 512GB", and
// "al1444p" matches "AL14-44P". Each token must match somewhere.
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(query) {
  return normalize(query).split(' ').filter(Boolean);
}

function smartMatch(tokens, item) {
  if (!tokens.length) return true;
  const loose = normalize(`${item.deskripsi} ${item.sku} ${item.pn} ${item.type}`);
  const tight = loose.replace(/ /g, '');
  return tokens.every((t) => loose.includes(t) || tight.includes(t));
}

// Wrap query tokens found in an already-HTML-escaped string with <mark>.
function highlight(escapedText, tokens) {
  if (!tokens.length) return escapedText;
  const uniq = [...new Set(tokens)].filter((t) => t.length >= 2).sort((a, b) => b.length - a.length);
  if (!uniq.length) return escapedText;
  const re = new RegExp('(' + uniq.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return escapedText.replace(re, '<mark>$1</mark>');
}

export const PriceList = {
  all: [],
  filtered: [],
  search: '',
  _tokens: [],
  sort: 'no',
  chip: 'all',
  costVisible: null,
  expanded: new Set(),
  _wired: false,
  _currentDate: null,

  visibleMetrics() {
    return METRICS.filter((m) => !m.cost || this.costVisible);
  },

  async render({ force = false } = {}) {
    if (this.costVisible === null) this.costVisible = !Auth.isSales();
    this.wire();

    const dateSelect = document.getElementById('pricelist-date-select');
    let targetDate = dateSelect.value;
    if (!targetDate || force) {
      targetDate = targetDate || (await DB.getAllDates())[0] || todayKey();
      dateSelect.value = targetDate;
    }

    const list = document.getElementById('pricelist-list');
    list.innerHTML = `<div class="loading-block"><span class="spinner"></span> Memuat price list…</div>`;

    let rows = await DB.getData(targetDate);
    let actualDate = targetDate;
    let fallback = false;
    if (!rows) {
      const latest = await DB.getLatestData();
      if (latest) {
        rows = latest.data;
        actualDate = latest.date;
        fallback = true;
      } else {
        rows = [];
      }
    }
    this._currentDate = actualDate;

    const prevObj = await DB.getPreviousData(actualDate);
    const prevMap = new Map();
    (prevObj?.data || []).forEach((p) => prevMap.set(p.deskripsi.toLowerCase(), p));

    document.getElementById('pricelist-date-display').innerHTML =
      `Menampilkan <strong>${formatDate(actualDate)}${fallback ? ' (terbaru)' : ''}</strong>` +
      ` · dibandingkan <strong>${prevObj ? formatDate(prevObj.date) : 'tidak ada'}</strong>`;

    this.all = rows.map((p) => {
      const prev = prevMap.get(p.deskripsi.toLowerCase());
      return {
        ...p,
        hargaOnline: PriceCalc.hargaOnline(p.distribusi),
        hargaOffline: PriceCalc.hargaOffline(p.distribusi),
        isNew: !prev,
        prevDistribusi: prev ? prev.distribusi : null,
        prevHargaOnline: prev ? PriceCalc.hargaOnline(prev.distribusi) : null,
        prevHargaOffline: prev ? PriceCalc.hargaOffline(prev.distribusi) : null,
        prevSerpong: prev ? prev.serpong : null,
        prevHarco: prev ? prev.harco : null,
        prevTotal: prev ? prev.total : null,
        prevPromo: prev ? prev.promo_sellout : null,
      };
    });

    this.apply();
  },

  wire() {
    if (this._wired) return;
    this._wired = true;

    const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);

    on('pricelist-date-select', 'change', () => this.render());
    on('btn-pl-refresh', 'click', (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.dataset.label = b.textContent;
      b.innerHTML = `${BTN_SPINNER}`;
      this.render({ force: false }).finally(() => {
        b.disabled = false;
        b.textContent = b.dataset.label || '↻ Refresh';
      });
    });
    on('btn-export', 'click', () => this.exportToExcel());
    on('btn-pl-upload', 'click', () => this.openQuickUpload());
    on('btn-toggle-distribusi', 'click', () => {
      this.costVisible = !this.costVisible;
      document.getElementById('btn-toggle-distribusi').textContent =
        this.costVisible ? 'Sembunyikan Distribusi' : 'Tampilkan Distribusi';
      this.renderList();
    });

    const search = document.getElementById('pl-search');
    let t;
    search?.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        this.search = e.target.value;
        this.apply();
      }, 150);
    });

    on('pl-sort', 'change', (e) => {
      this.sort = e.target.value;
      this.apply();
    });

    document.querySelectorAll('#page-pricelist .chip').forEach((c) =>
      c.addEventListener('click', () => {
        this.chip = c.dataset.filter;
        document.querySelectorAll('#page-pricelist .chip').forEach((x) =>
          x.setAttribute('aria-pressed', String(x === c))
        );
        this.apply();
      })
    );

    // Delegated row expand + row actions.
    document.getElementById('pricelist-list').addEventListener('click', (e) => {
      const head = e.target.closest('.pl-row-head');
      if (head) {
        const row = head.closest('.pl-row');
        const idx = row.dataset.idx;
        if (this.expanded.has(idx)) this.expanded.delete(idx);
        else this.expanded.add(idx);
        this.renderList();
        return;
      }
      const copyBtn = e.target.closest('[data-copy]');
      if (copyBtn) {
        copyToClipboard(copyBtn.dataset.copy, 'Tersalin');
        return;
      }
      const searchBtn = e.target.closest('[data-gsearch]');
      if (searchBtn) {
        window.open('https://www.google.com/search?q=' + encodeURIComponent(searchBtn.dataset.gsearch), '_blank', 'noopener');
      }
    });
  },

  apply() {
    this._tokens = tokenize(this.search);
    this.filtered = this.all.filter((p) => {
      if (!smartMatch(this._tokens, p)) return false;
      switch (this.chip) {
        case 'new': return p.isNew;
        case 'price-changed': return p.prevDistribusi != null && p.distribusi !== p.prevDistribusi;
        case 'stock-low': return (p.total || 0) > 0 && (p.total || 0) <= 5;
        case 'oos': return (p.total || 0) <= 0;
        default: return true;
      }
    });

    this.filtered.sort(SORTS[this.sort] || SORTS.no);
    this.renderList();
    this.renderMeta();
  },

  renderMeta() {
    const meta = document.getElementById('pricelist-count');
    if (!meta) return;
    const total = this.all.length;
    const shown = this.filtered.length;
    meta.textContent = shown === total ? `${total} barang` : `${shown} dari ${total} barang`;
  },

  renderList() {
    const container = document.getElementById('pricelist-list');
    if (!this.all.length) {
      container.innerHTML = `<div class="empty-state">Tidak ada data untuk tanggal ini.</div>`;
      return;
    }
    if (!this.filtered.length) {
      container.innerHTML = `<div class="empty-state">Tidak ada barang yang cocok.</div>`;
      return;
    }
    const metrics = this.visibleMetrics();
    container.innerHTML = this.filtered.map((p, i) => this.renderRow(p, i, metrics)).join('');
  },

  renderRow(p, i, metrics) {
    const idx = String(p.no ?? i);
    const open = this.expanded.has(idx);

    const stats = metrics
      .map((m) => {
        const cur = p[m.key] || 0;
        const val = m.kind === 'money' ? formatCurrency(cur) : formatNumber(cur);
        const chip = m.prev ? deltaChip(cur, p[m.prev], m.kind) : '';
        return `<span class="pl-stat${m.serpong ? ' is-serpong' : ''}">
          <span class="pl-k">${m.label}</span>
          <span class="pl-v">${val}</span>${chip}
        </span>`;
      })
      .join('');

    const promo = p.promo_sellout && p.promo_sellout.toLowerCase() !== 'tidak ada'
      ? `<span class="pl-stat pl-promo">Promo: ${escapeHtml(p.promo_sellout)}</span>`
      : '';

    const name = highlight(escapeHtml(p.deskripsi), this._tokens || []);

    return `
      <article class="pl-row${open ? ' is-open' : ''}" data-idx="${escapeHtml(idx)}">
        <button class="pl-row-head" aria-expanded="${open}">
          <span class="pl-name">${p.isNew ? '<span class="tag tag-new">BARU</span> ' : ''}${name}</span>
          <span class="pl-caret" aria-hidden="true">▾</span>
        </button>
        <div class="pl-stats">${stats}${promo}</div>
        ${open ? this.renderDetail(p, metrics) : ''}
      </article>`;
  },

  renderDetail(p, metrics) {
    const rows = metrics
      .map((m) => {
        const cur = p[m.key] || 0;
        const prev = m.prev ? p[m.prev] : null;
        const fmt = (v) => (v == null ? '—' : m.kind === 'money' ? formatCurrency(v) : formatNumber(v));
        let diff = '';
        if (prev != null && cur !== prev) {
          const up = cur > prev;
          const d = Math.abs(cur - prev);
          diff = `<span class="delta-chip ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${m.kind === 'money' ? formatCurrency(d) : formatNumber(d)}</span>`;
        }
        return `<tr><td>${m.label}</td><td class="num">${fmt(prev)}</td><td class="num">${fmt(cur)} ${diff}</td></tr>`;
      })
      .join('');

    const meta = [p.sku && `SKU ${escapeHtml(p.sku)}`, p.pn && `PN ${escapeHtml(p.pn)}`, p.type && `Type ${escapeHtml(p.type)}`]
      .filter(Boolean)
      .join(' · ');

    const copyText = `${p.deskripsi} ${formatCurrency(p.hargaOnline || 0)}`;

    return `
      <div class="pl-detail">
        <table class="pl-detail-table">
          <thead><tr><th>Metrik</th><th class="num">Kemarin</th><th class="num">Hari ini</th></tr></thead>
          <tbody>${rows}
            <tr><td>Promo</td><td>${escapeHtml(p.prevPromo || '—')}</td><td>${escapeHtml(p.promo_sellout || '—')}</td></tr>
          </tbody>
        </table>
        ${meta ? `<p class="pl-detail-meta">${meta}</p>` : ''}
        <div class="pl-detail-actions">
          <button class="btn btn-sm btn-secondary" data-copy="${escapeHtml(copyText)}">⧉ Salin nama + harga online</button>
          <button class="btn btn-sm btn-ghost" data-gsearch="${escapeHtml(p.deskripsi)}">⌕ Cari di Google</button>
        </div>
      </div>`;
  },

  // ---- admin: quick upload straight from this page --------------------
  openQuickUpload() {
    const defaultDate = todayKey();
    showModal(
      'Upload Price List',
      `<div class="form-stack">
        <div class="form-group">
          <label class="form-label" for="qu-date">Tanggal berlaku</label>
          <input type="date" id="qu-date" class="input-field" value="${defaultDate}">
        </div>
        <div class="form-group">
          <label class="form-label" for="qu-file">File Excel (.xlsx / .xls)</label>
          <input type="file" id="qu-file" class="input-field" accept=".xlsx,.xls">
        </div>
        <p id="qu-status" class="upload-status"></p>
      </div>`,
      [
        { text: 'Batal', class: 'btn-secondary', onClick: hideModal },
        {
          text: 'Upload & Tampilkan',
          class: 'btn-primary',
          onClick: async () => {
            const dateStr = document.getElementById('qu-date').value;
            const file = document.getElementById('qu-file').files[0];
            const status = document.getElementById('qu-status');
            const btn = document.querySelector('#modal-footer .btn:last-child');

            if (!dateStr) return showToast('Pilih tanggal', 'error');
            if (isSunday(dateStr)) return showToast('Tidak bisa upload untuk hari Minggu', 'error');
            if (!file) return showToast('Pilih file', 'error');

            const existing = await DB.getData(dateStr);
            if (existing) {
              const ok = await confirmModal({
                title: 'Timpa data tanggal ini?',
                message: `Sudah ada ${existing.length} baris untuk <strong>${formatDate(dateStr)}</strong>.`,
                confirmText: 'Timpa',
                danger: true,
              });
              if (!ok) return this.openQuickUpload();
            }

            try {
              btn.disabled = true;
              btn.innerHTML = `${BTN_SPINNER} Memproses…`;
              status.textContent = 'Memproses…';
              const products = await ExcelParser.parse(file);
              if (!products.length) throw new Error('Tidak ada baris produk yang valid');
              await DB.saveData(dateStr, products, { filename: file.name, uploadedBy: Auth.currentUser?.email });
              hideModal();
              showToast(`${products.length} produk tersimpan untuk ${formatDate(dateStr)}`, 'success');
              document.getElementById('pricelist-date-select').value = dateStr;
              this.expanded.clear();
              await this.render();
            } catch (err) {
              status.innerHTML = `<span class="err">${escapeHtml(err.message || String(err))}</span>`;
              btn.disabled = false;
              btn.textContent = 'Upload & Tampilkan';
            }
          },
        },
      ]
    );
  },

  exportToExcel() {
    if (!this.filtered.length) return showToast('Tidak ada data untuk diexport', 'error');
    const metrics = this.visibleMetrics();
    const data = this.filtered.map((p, i) => {
      const row = { 'No.': i + 1, 'Deskripsi / Nama Barang': p.deskripsi };
      metrics.forEach((m) => (row[m.label] = p[m.key] || 0));
      row['Promo Sellout'] = p.promo_sellout || '';
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(data, { origin: 'A3' });
    XLSX.utils.sheet_add_aoa(ws, [[`MASTER DATA PRICELIST - ${formatDate(this._currentDate)}`]], { origin: 'A1' });
    const cols = Object.keys(data[0] || {}).length;
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(cols - 1, 0) } }];

    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (!cell) continue;
        if (R === 0) cell.s = { font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1a2238' } }, alignment: { horizontal: 'center' } };
        if (R === 2) cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '2a3754' } }, alignment: { horizontal: 'center' } };
        const header = ws[XLSX.utils.encode_cell({ r: 2, c: C })];
        if (R >= 3 && cell.t === 'n' && header) {
          const h = String(header.v);
          if (['Distribusi', 'Online', 'Offline', 'SRP', 'Total', 'Harco', 'Serpong'].includes(h)) cell.z = '#,##0';
        }
      }
    }
    ws['!cols'] = Object.keys(data[0] || {}).map((k) =>
      k === 'Deskripsi / Nama Barang' ? { wch: 60 } : k === 'No.' ? { wch: 5 } : { wch: 14 }
    );

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PriceList');
    XLSX.writeFile(wb, `Vicmic_PriceList_${this._currentDate}.xlsx`);
  },
};
