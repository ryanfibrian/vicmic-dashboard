// ============================================================================
// pages/dashboard.js — decision-focused daily overview.
//
// Layout: KPI strip, then full-width stacked blocks (no ragged 2-column grid).
// Every block is a table capped to N rows with a "Lihat semua" expander, so the
// page has a predictable rhythm regardless of how much moved that day.
//   - Perlu Perhatian – Stok : habis / hilang / menipis / turun drastis
//   - Perubahan Harga        : biggest moves (online price for non-admins)
//   - Rebalance Cabang       : tarik ke Serpong / retur ke Harco
//   - Barang Baru Hari Ini   : stock + online price
// KPI cards jump to the price list pre-filtered.
// ============================================================================

import { DB } from '../db.js';
import { Auth } from '../auth.js';
import { PriceCalc } from '../priceCalc.js';
import { PriceList } from './pricelist.js';
import { formatNumber, formatCurrency, formatDate, escapeHtml } from '../utils.js';
import { showLoading, copyToClipboard } from '../ui.js';

const LOW_STOCK = 5;

export const Dashboard = {
  _wired: false,
  _blocks: {}, // id -> { head, rows, cap }

  async render() {
    if (!this._wired) {
      this._wired = true;
      document.getElementById('btn-dash-refresh')?.addEventListener('click', (e) => {
        e.currentTarget.disabled = true;
        this.render().finally(() => (e.currentTarget.disabled = false));
      });
      document.getElementById('kpi-grid')?.addEventListener('click', (e) => {
        const card = e.target.closest('.kpi-card.is-link');
        if (!card) return;
        PriceList.pendingChip = card.dataset.jump;
        window.location.hash = 'pricelist';
      });
      document.querySelector('#page-dashboard .dash-blocks')?.addEventListener('click', (e) => {
        const more = e.target.closest('.dash-more');
        if (more) {
          const id = more.dataset.for;
          this._blocks[id].cap = Infinity;
          this.paint(id);
          return;
        }
        const copy = e.target.closest('[data-copy]');
        if (copy) copyToClipboard(copy.dataset.copy, 'Tersalin');
      });
    }

    showLoading(document.getElementById('kpi-grid'), 'Memuat dashboard…');

    const dateStr = (await DB.getAllDates())[0] || formatDate(new Date());
    document.getElementById('dashboard-date-label').textContent = formatDate(dateStr);

    const [data, prevObj] = await Promise.all([DB.getData(dateStr), DB.getPreviousData(dateStr)]);
    const rows = data || [];
    const prev = prevObj?.data || [];
    const prevMap = new Map(prev.map((p) => [p.deskripsi.toLowerCase(), p]));
    const curKeys = new Set(rows.map((p) => p.deskripsi.toLowerCase()));

    const showCost = Auth.isAdmin();
    const model = rows.map((p) => {
      const before = prevMap.get(p.deskripsi.toLowerCase()) || null;
      const online = PriceCalc.hargaOnline(p.distribusi);
      const price = showCost ? p.distribusi : online;
      const beforePrice = before ? (showCost ? before.distribusi : PriceCalc.hargaOnline(before.distribusi)) : 0;
      return {
        ...p,
        before,
        isNew: !before,
        hargaOnline: online,
        price,
        beforePrice,
        priceDiff: before ? price - beforePrice : 0,
        stockDiff: before ? (p.total || 0) - (before.total || 0) : 0,
      };
    });
    const disappeared = prev.filter((p) => !curKeys.has(p.deskripsi.toLowerCase()));

    this.renderKPIs(model, disappeared, showCost);
    this.buildStock(model, disappeared);
    this.buildPrice(model, showCost);
    this.buildRebalance(rows);
    this.buildNew(model);
  },

  // ---- KPI strip ------------------------------------------------------
  renderKPIs(model, disappeared, showCost) {
    const totalStock = model.reduce((s, p) => s + (p.total || 0), 0);
    const up = model.filter((p) => p.before && p.priceDiff > 0).length;
    const down = model.filter((p) => p.before && p.priceDiff < 0).length;
    const newCount = model.filter((p) => p.isNew).length;
    const low = model.filter((p) => (p.total || 0) > 0 && (p.total || 0) <= LOW_STOCK).length;
    const oos = model.filter((p) => (p.total || 0) <= 0).length + disappeared.length;

    const kpis = [
      { label: 'Tipe Produk', value: model.length, icon: '📦', accent: 'var(--accent)' },
      { label: 'Stok Global', value: totalStock, icon: '🌍', accent: '#7c3aed' },
      { label: 'Harga Naik', value: up, icon: '📈', accent: 'var(--up)', jump: 'price-changed' },
      { label: 'Harga Turun', value: down, icon: '📉', accent: 'var(--down)', jump: 'price-changed' },
      { label: 'Barang Baru', value: newCount, icon: '✨', accent: '#0891b2', jump: 'new' },
      { label: 'Stok Menipis', value: low, icon: '⚠️', accent: 'var(--warning)', jump: 'stock-low' },
      { label: 'Barang Habis', value: oos, icon: '🚫', accent: 'var(--danger)', jump: 'oos' },
    ];

    document.getElementById('kpi-grid').innerHTML = kpis
      .map(
        (k) => `
        <div class="kpi-card${k.jump ? ' is-link' : ''}" ${k.jump ? `data-jump="${k.jump}"` : ''} style="--card-accent:${k.accent}">
          <div class="kpi-icon" aria-hidden="true">${k.icon}</div>
          <div class="kpi-value">${formatNumber(k.value)}</div>
          <div class="kpi-label">${k.label}</div>
        </div>`
      )
      .join('');
  },

  // ---- generic block renderer --------------------------------------
  register(id, headers, rows, cap, countId) {
    this._blocks[id] = { headers, rows, cap };
    if (countId) document.getElementById(countId).textContent = rows.length || '';
    this.paint(id);
  },

  paint(id) {
    const el = document.getElementById(id);
    const b = this._blocks[id];
    if (!el || !b) return;
    const parent = el.closest('.dash-block') || el.parentElement;
    parent.querySelector(`.dash-more[data-for="${id}"]`)?.remove();

    if (!b.rows.length) {
      el.innerHTML = `<table class="dash-table"><tbody><tr><td class="cell-empty">Tidak ada</td></tr></tbody></table>`;
      return;
    }
    const shown = b.rows.slice(0, b.cap);
    el.innerHTML = `<table class="dash-table">
      <thead><tr>${b.headers.map((h) => `<th class="${h.cls || ''}">${h.label ?? h}</th>`).join('')}</tr></thead>
      <tbody>${shown.join('')}</tbody></table>`;
    if (b.rows.length > b.cap) {
      const btn = document.createElement('button');
      btn.className = 'dash-more';
      btn.dataset.for = id;
      btn.textContent = `Lihat semua (${b.rows.length})`;
      el.after(btn);
    }
  },

  // ---- blocks -----------------------------------------------------
  buildStock(model, disappeared) {
    const items = [];
    model.forEach((p) => {
      const t = p.total || 0;
      if (t <= 0) items.push({ p, kind: 'oos', w: 100 });
      else if (t <= LOW_STOCK) items.push({ p, kind: 'low', w: 50 - t });
      else if (p.before && p.stockDiff <= -10) items.push({ p, kind: 'drop', w: Math.abs(p.stockDiff) / 10 });
    });
    disappeared.forEach((p) => items.push({ p, kind: 'gone', w: 90 }));
    items.sort((a, b) => b.w - a.w);

    const TAG = {
      oos: '<span class="tag tag-danger">HABIS</span>',
      gone: '<span class="tag tag-danger">HILANG</span>',
      low: '<span class="tag tag-warning">MENIPIS</span>',
      drop: '<span class="tag tag-warning">TURUN</span>',
    };
    const rows = items.map(({ p, kind }) => {
      const t = p.total || 0;
      const detail =
        kind === 'gone'
          ? 'tidak ada di data hari ini'
          : kind === 'drop'
          ? `${p.before.total} → ${t}`
          : `sisa ${t} · Srp ${p.serpong ?? 0} / Hrc ${p.harco ?? 0}`;
      const delta = p.before && p.stockDiff !== 0
        ? `<span class="delta-chip ${p.stockDiff > 0 ? 'up' : 'down'}">${p.stockDiff > 0 ? '▲' : '▼'} ${Math.abs(p.stockDiff)}</span>`
        : '';
      return `<tr>
        <td class="t-name">${escapeHtml(p.deskripsi)}</td>
        <td>${TAG[kind] || ''}</td>
        <td class="t-sub">${detail} ${delta}</td>
      </tr>`;
    });
    this.register('dash-stock-attention', ['Barang', { label: 'Status' }, { label: 'Detail' }], rows, 10, 'dc-stock');
  },

  buildPrice(model, showCost) {
    const moves = model
      .filter((p) => p.before && p.priceDiff !== 0)
      .sort((a, b) => Math.abs(b.priceDiff) - Math.abs(a.priceDiff));
    const rows = moves.map((p) => {
      const upd = p.priceDiff > 0;
      return `<tr>
        <td class="t-name">${escapeHtml(p.deskripsi)}</td>
        <td class="t-num t-sub">${formatCurrency(p.beforePrice)}</td>
        <td class="t-num t-today ${upd ? 'is-up' : 'is-down'}">${formatCurrency(p.price)}</td>
        <td class="t-num ${upd ? 'is-up' : 'is-down'}">${upd ? '+' : '−'}${formatCurrency(Math.abs(p.priceDiff))}</td>
      </tr>`;
    });
    const priceLabel = showCost ? 'Distribusi' : 'Online';
    this.register(
      'dash-price-moves',
      ['Barang', { label: `${priceLabel} kemarin`, cls: 't-num' }, { label: 'Hari ini', cls: 't-num' }, { label: 'Selisih', cls: 't-num' }],
      rows,
      10,
      'dc-price'
    );
  },

  buildRebalance(rows) {
    const pull = [];
    const ret = [];
    rows.forEach((item) => {
      const srp = parseFloat(item.serpong) || 0;
      const hrc = parseFloat(item.harco) || 0;
      if (srp <= 1 && hrc > 10) pull.push(item);
      if (hrc < 5 && srp > 0) ret.push(item);
    });
    pull.sort((a, b) => (b.harco || 0) - (a.harco || 0));
    ret.sort((a, b) => (a.harco || 0) - (b.harco || 0));

    const rowFor = (item) => `<tr>
      <td class="t-name">${escapeHtml(item.deskripsi)}
        <button class="btn-inline" data-copy="${escapeHtml(item.deskripsi)}" title="Salin" aria-label="Salin nama">⧉</button></td>
      <td class="t-num">${item.serpong || 0}</td>
      <td class="t-num">${item.harco || 0}</td>
    </tr>`;

    this.register('dash-pull-serpong', ['Barang', { label: 'Srp', cls: 't-num' }, { label: 'Hrc', cls: 't-num' }], pull.map(rowFor), 8);
    this.register('dash-return-harco', ['Barang', { label: 'Srp', cls: 't-num' }, { label: 'Hrc', cls: 't-num' }], ret.map(rowFor), 8);
  },

  buildNew(model) {
    const rows = model
      .filter((p) => p.isNew)
      .map(
        (p) => `<tr>
          <td class="t-name"><span class="tag tag-new">BARU</span> ${escapeHtml(p.deskripsi)}</td>
          <td class="t-num">${p.total || 0}</td>
          <td class="t-num">${formatCurrency(p.hargaOnline || 0)}</td>
        </tr>`
      );
    this.register('dash-new-items', ['Barang', { label: 'Stok', cls: 't-num' }, { label: 'Harga Online', cls: 't-num' }], rows, 10, 'dc-new');
  },
};
