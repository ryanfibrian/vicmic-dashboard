// ============================================================================
// pages/dashboard.js — decision-focused daily overview. No vanity charts; every
// panel answers "what do I need to act on today?":
//   - KPI strip: today's shape + what moved
//   - Perubahan Harga: biggest price moves (repricing / margin)
//   - Perlu Perhatian – Stok: out of stock, running low, big drops (reorder)
//   - Rebalance Cabang: pull to Serpong / return to Harco (logistics)
//   - Barang Baru: what landed today (what to push)
// ============================================================================

import { DB } from '../db.js';
import { Auth } from '../auth.js';
import { PriceCalc } from '../priceCalc.js';
import { formatNumber, formatCurrency, formatDate, escapeHtml } from '../utils.js';
import { showLoading, copyToClipboard } from '../ui.js';

const LOW_STOCK = 5;

export const Dashboard = {
  _wired: false,

  async render() {
    if (!this._wired) {
      this._wired = true;
      document.getElementById('btn-dash-refresh')?.addEventListener('click', (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        this.render().finally(() => (b.disabled = false));
      });
    }

    const grid = document.getElementById('kpi-grid');
    showLoading(grid, 'Memuat dashboard…');

    const dateStr = (await DB.getAllDates())[0] || formatDate(new Date());
    document.getElementById('dashboard-date-label').textContent = formatDate(dateStr);

    const [data, prevObj] = await Promise.all([DB.getData(dateStr), DB.getPreviousData(dateStr)]);
    const rows = data || [];
    const prev = prevObj?.data || [];
    const prevMap = new Map(prev.map((p) => [p.deskripsi.toLowerCase(), p]));
    const curKeys = new Set(rows.map((p) => p.deskripsi.toLowerCase()));

    // Non-admins never see cost (distribusi); price panels use Harga Online.
    const showCost = Auth.isAdmin();
    this._showCost = showCost;

    // Build a per-item diff model once.
    const model = rows.map((p) => {
      const before = prevMap.get(p.deskripsi.toLowerCase()) || null;
      const online = PriceCalc.hargaOnline(p.distribusi);
      const beforeOnline = before ? PriceCalc.hargaOnline(before.distribusi) : 0;
      const price = showCost ? p.distribusi : online;
      const beforePrice = showCost ? (before ? before.distribusi : 0) : beforeOnline;
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

    this.renderKPIs(model, disappeared);
    this.renderPriceMoves(model);
    this.renderStockAttention(model, disappeared);
    this.renderRebalance(rows);
    this.renderNewItems(model);
  },

  renderKPIs(model, disappeared) {
    const totalStock = model.reduce((s, p) => s + (p.total || 0), 0);
    const up = model.filter((p) => p.before && p.priceDiff > 0).length;
    const down = model.filter((p) => p.before && p.priceDiff < 0).length;
    const newCount = model.filter((p) => p.isNew).length;
    const lowCount = model.filter((p) => (p.total || 0) > 0 && (p.total || 0) <= LOW_STOCK).length;

    const kpis = [
      { label: 'Tipe Produk', value: model.length, icon: '📦', accent: 'var(--accent)' },
      { label: 'Stok Global', value: totalStock, icon: '🌍', accent: '#a78bfa' },
      { label: 'Harga Naik', value: up, icon: '📈', accent: 'var(--success)' },
      { label: 'Harga Turun', value: down, icon: '📉', accent: 'var(--danger)' },
      { label: 'Barang Baru', value: newCount, icon: '✨', accent: '#38bdf8' },
      { label: 'Stok Menipis', value: lowCount, icon: '⚠️', accent: 'var(--warning)' },
      { label: 'Barang Habis', value: disappeared.length, icon: '🚫', accent: 'var(--danger)' },
    ];

    document.getElementById('kpi-grid').innerHTML = kpis
      .map(
        (k) => `
        <div class="kpi-card" style="--card-accent:${k.accent}">
          <div class="kpi-icon" aria-hidden="true">${k.icon}</div>
          <div class="kpi-value">${formatNumber(k.value)}</div>
          <div class="kpi-label">${k.label}</div>
        </div>`
      )
      .join('');
  },

  renderPriceMoves(model) {
    const moves = model
      .filter((p) => p.before && p.priceDiff !== 0)
      .sort((a, b) => Math.abs(b.priceDiff) - Math.abs(a.priceDiff));

    const box = document.getElementById('dash-price-moves');
    if (!moves.length) {
      box.innerHTML = '<div class="empty-state-sm">Tidak ada perubahan harga hari ini</div>';
      return;
    }

    const label = this._showCost ? 'harga distribusi' : 'harga online';
    box.innerHTML =
      `<div class="alert-count"><span>${moves.length} ${label} berubah</span></div>` +
      moves
        .slice(0, 60)
        .map((p) => {
          const up = p.priceDiff > 0;
          return `
          <div class="alert-item">
            <div class="alert-product">${escapeHtml(p.deskripsi)}</div>
            <div class="alert-prices">
              <span class="alert-old">${formatCurrency(p.beforePrice)}</span>
              <span class="alert-arrow ${up ? 'is-up' : 'is-down'}">${up ? '▲' : '▼'}</span>
              <span class="alert-new">${formatCurrency(p.price)}</span>
            </div>
            <div class="alert-diff ${up ? 'is-up' : 'is-down'}">${up ? '+' : '−'}${formatCurrency(Math.abs(p.priceDiff))}</div>
          </div>`;
        })
        .join('');
  },

  renderStockAttention(model, disappeared) {
    const items = [];
    model.forEach((p) => {
      const t = p.total || 0;
      if (t <= 0) items.push({ p, kind: 'oos', weight: 100 });
      else if (t <= LOW_STOCK) items.push({ p, kind: 'low', weight: 50 - t });
      else if (p.before && p.stockDiff <= -10) items.push({ p, kind: 'drop', weight: Math.abs(p.stockDiff) / 10 });
    });
    disappeared.forEach((p) => items.push({ p, kind: 'gone', weight: 90 }));
    items.sort((a, b) => b.weight - a.weight);

    const box = document.getElementById('dash-stock-attention');
    if (!items.length) {
      box.innerHTML = '<div class="empty-state-sm">Tidak ada stok yang perlu perhatian</div>';
      return;
    }

    const tag = {
      oos: '<span class="tag tag-danger">HABIS</span>',
      gone: '<span class="tag tag-danger">HILANG</span>',
      low: '<span class="tag tag-warning">MENIPIS</span>',
      drop: '<span class="tag tag-warning">TURUN</span>',
    };

    box.innerHTML =
      `<div class="alert-count"><span>${items.length} butuh perhatian</span></div>` +
      items
        .slice(0, 60)
        .map(({ p, kind }) => {
          const t = p.total || 0;
          const detail =
            kind === 'gone'
              ? 'tidak ada di data hari ini'
              : kind === 'drop'
              ? `${p.before.total} → ${t} (${p.stockDiff})`
              : `sisa ${t} (Srp ${p.serpong ?? 0} · Hrc ${p.harco ?? 0})`;
          return `
          <div class="alert-item">
            <div class="alert-product">${tag[kind] || ''} ${escapeHtml(p.deskripsi)}</div>
            <div class="stock-detail">${detail}</div>
          </div>`;
        })
        .join('');
  },

  renderRebalance(rows) {
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

    const row = (item) => `
      <tr>
        <td class="col-deskripsi">${escapeHtml(item.deskripsi)}
          <button class="btn-inline" data-copy="${escapeHtml(item.deskripsi)}" title="Salin" aria-label="Salin nama">⧉</button>
        </td>
        <td class="num">${item.serpong || 0}</td>
        <td class="num">${item.harco || 0}</td>
      </tr>`;

    const fill = (id, list, empty) => {
      document.getElementById(id).innerHTML = list.length
        ? list.map(row).join('')
        : `<tr><td colspan="3" class="cell-empty">${empty}</td></tr>`;
    };
    fill('pull-serpong-body', pull, 'Tidak ada rekomendasi');
    fill('return-harco-body', ret, 'Tidak ada rekomendasi');

    document.querySelectorAll('#page-dashboard [data-copy]').forEach((b) =>
      b.addEventListener('click', () => copyToClipboard(b.dataset.copy, 'Tersalin: ' + b.dataset.copy))
    );
  },

  renderNewItems(model) {
    const items = model.filter((p) => p.isNew);
    const box = document.getElementById('dash-new-items');
    if (!items.length) {
      box.innerHTML = '<div class="empty-state-sm">Tidak ada barang baru hari ini</div>';
      return;
    }
    box.innerHTML =
      `<div class="alert-count"><span>${items.length} barang baru</span></div>` +
      items
        .map(
          (p) => `
        <div class="alert-item">
          <div class="alert-product"><span class="tag tag-new">BARU</span> ${escapeHtml(p.deskripsi)}</div>
          <div class="alert-prices">
            <span class="pl-k">Stok</span> <span class="alert-new">${p.total || 0}</span>
            <span class="pl-k">Online</span> <span class="alert-new">${formatCurrency(p.hargaOnline || 0)}</span>
          </div>
        </div>`
        )
        .join('');
  },
};
