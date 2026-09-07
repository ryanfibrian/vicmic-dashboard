// ============================================================================
// pages/dashboard.js — admin overview: KPIs, brand stock trend chart, price /
// stock change alerts, and branch-transfer recommendations.
// ============================================================================

import { DB } from '../db.js';
import { formatNumber, formatCurrency, formatDate, escapeHtml } from '../utils.js';
import { showLoading, copyToClipboard } from '../ui.js';

export const Dashboard = {
  async render() {
    const grid = document.getElementById('kpi-grid');
    showLoading(grid, 'Memuat dashboard…');

    const currentDateStr = (await DB.getAllDates())[0] || formatDate(new Date());
    document.getElementById('dashboard-date-label').textContent = formatDate(currentDateStr);

    const [data, prevObj] = await Promise.all([
      DB.getData(currentDateStr),
      DB.getPreviousData(currentDateStr),
    ]);
    const rows = data || [];
    const prevRows = prevObj?.data || [];

    this.renderKPIs(rows, prevRows);
    this.renderPriceAlerts(rows, prevRows);
    this.renderStockAlerts(rows, prevRows);
    this.renderRecommendations(rows);

    const tfSelect = document.getElementById('chart-timeframe');
    if (tfSelect && !tfSelect.dataset.wired) {
      tfSelect.dataset.wired = '1';
      tfSelect.addEventListener('change', () =>
        this.renderBrandChart(currentDateStr, parseInt(tfSelect.value, 10) || 7)
      );
    }
    await this.renderBrandChart(currentDateStr, parseInt(tfSelect?.value, 10) || 7);
  },

  renderKPIs(data, prevData) {
    const grid = document.getElementById('kpi-grid');
    let serpong = 0;
    let harco = 0;
    let global = 0;

    const prevKeys = new Set(prevData.map((p) => p.deskripsi.toLowerCase()));
    const currentKeys = new Set();
    let newCount = 0;

    data.forEach((p) => {
      currentKeys.add(p.deskripsi.toLowerCase());
      serpong += p.serpong;
      harco += p.harco;
      global += p.total;
      if (!prevKeys.has(p.deskripsi.toLowerCase())) newCount += 1;
    });
    const oosCount = prevData.filter((p) => !currentKeys.has(p.deskripsi.toLowerCase())).length;

    const kpis = [
      { label: 'Tipe Produk', value: data.length, icon: '📦', accent: 'var(--accent)' },
      { label: 'Stok Global', value: global, icon: '🌍', accent: '#a78bfa' },
      { label: 'Stok Serpong', value: serpong, icon: '🏬', accent: '#38bdf8' },
      { label: 'Stok Harco', value: harco, icon: '🏢', accent: '#f87171' },
      { label: 'Produk Baru', value: newCount, icon: '✨', accent: 'var(--success)' },
      { label: 'Produk Habis', value: oosCount, icon: '🚫', accent: 'var(--warning)' },
    ];

    grid.innerHTML = kpis
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

  renderPriceAlerts(data, prevData) {
    const container = document.getElementById('price-alert-list');
    const prevMap = new Map(prevData.map((p) => [p.deskripsi.toLowerCase(), p.distribusi]));

    const alerts = [];
    data.forEach((p) => {
      const key = p.deskripsi.toLowerCase();
      if (prevMap.has(key) && p.distribusi !== prevMap.get(key)) {
        alerts.push({ deskripsi: p.deskripsi, old: prevMap.get(key), new: p.distribusi, diff: p.distribusi - prevMap.get(key) });
      }
    });
    alerts.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    if (!alerts.length) {
      container.innerHTML = '<div class="empty-state-sm">Tidak ada perubahan harga</div>';
      return;
    }

    container.innerHTML =
      `<div class="alert-count">${alerts.length} produk berubah harga</div>` +
      alerts
        .slice(0, 50)
        .map((a) => {
          const up = a.diff > 0;
          return `
          <div class="alert-item">
            <div class="alert-product">${escapeHtml(a.deskripsi)}</div>
            <div class="alert-prices">
              <span class="alert-old">${formatCurrency(a.old)}</span>
              <span class="alert-arrow ${up ? 'is-up' : 'is-down'}">${up ? '▲' : '▼'}</span>
              <span class="alert-new">${formatCurrency(a.new)}</span>
            </div>
            <div class="alert-diff ${up ? 'is-up' : 'is-down'}">${up ? '+' : '−'}${formatCurrency(Math.abs(a.diff))}</div>
          </div>`;
        })
        .join('');
  },

  renderStockAlerts(data, prevData) {
    const container = document.getElementById('stock-alert-list');
    const prevMap = new Map(prevData.map((p) => [p.deskripsi.toLowerCase(), p.total || 0]));
    const currentKeys = new Set();
    const alerts = [];

    data.forEach((p) => {
      const key = p.deskripsi.toLowerCase();
      currentKeys.add(key);
      const cur = p.total || 0;
      if (prevMap.has(key)) {
        const prev = prevMap.get(key);
        if (cur !== prev) alerts.push({ deskripsi: p.deskripsi, old: prev, new: cur, diff: cur - prev, type: 'change' });
      } else {
        alerts.push({ deskripsi: p.deskripsi, old: 0, new: cur, diff: cur, type: 'new' });
      }
    });
    prevData.forEach((p) => {
      const key = p.deskripsi.toLowerCase();
      if (!currentKeys.has(key)) alerts.push({ deskripsi: p.deskripsi, old: p.total || 0, new: 0, diff: -(p.total || 0), type: 'oos' });
    });
    alerts.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    if (!alerts.length) {
      container.innerHTML = '<div class="empty-state-sm">Tidak ada perubahan stok</div>';
      return;
    }

    container.innerHTML =
      `<div class="alert-count">${alerts.length} produk berubah stok</div>` +
      alerts
        .slice(0, 50)
        .map((a) => {
          const up = a.diff > 0;
          const badge =
            a.type === 'new'
              ? '<span class="tag tag-new">BARU</span> '
              : a.type === 'oos'
              ? '<span class="tag tag-danger">HABIS</span> '
              : '';
          return `
          <div class="alert-item">
            <div class="alert-product">${badge}${escapeHtml(a.deskripsi)}</div>
            <div class="alert-prices">
              <span class="alert-old">${a.old}</span>
              <span class="alert-arrow ${up ? 'is-up' : 'is-down'}">${up ? '▲' : '▼'}</span>
              <span class="alert-new">${a.new}</span>
            </div>
            <div class="alert-diff ${up ? 'is-up' : 'is-down'}">${up ? '+' : '−'}${Math.abs(a.diff)}</div>
          </div>`;
        })
        .join('');
  },

  renderRecommendations(data) {
    const pull = [];
    const ret = [];
    data.forEach((item) => {
      const srp = parseFloat(item.serpong) || 0;
      const hrc = parseFloat(item.harco) || 0;
      if (srp <= 1 && hrc > 10) pull.push(item);
      if (hrc < 5 && srp > 0) ret.push(item);
    });
    pull.sort((a, b) => (b.harco || 0) - (a.harco || 0));
    ret.sort((a, b) => (a.harco || 0) - (b.harco || 0));

    const row = (item) => `
      <tr>
        <td class="col-deskripsi">
          ${escapeHtml(item.deskripsi)}
          <button class="btn-inline" data-copy="${escapeHtml(item.deskripsi)}" title="Salin nama barang" aria-label="Salin nama barang">⧉</button>
        </td>
        <td class="num">${item.serpong || 0}</td>
        <td class="num">${item.harco || 0}</td>
      </tr>`;

    const fill = (id, list, emptyText) => {
      const tbody = document.getElementById(id);
      tbody.innerHTML = list.length
        ? list.map(row).join('')
        : `<tr><td colspan="3" class="cell-empty">${emptyText}</td></tr>`;
    };
    fill('pull-serpong-body', pull, 'Tidak ada rekomendasi tarik ke Serpong');
    fill('return-harco-body', ret, 'Tidak ada rekomendasi retur ke Harco');

    document.querySelectorAll('#page-dashboard [data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => copyToClipboard(btn.dataset.copy, 'Tersalin: ' + btn.dataset.copy));
    });
  },

  async renderBrandChart(currentDateStr, daysLimit = 7) {
    const allDates = await DB.getAllDates();
    const dates = allDates.filter((d) => d <= currentDateStr).slice(0, daysLimit).reverse();
    if (!dates.length) return;

    const histories = await Promise.all(dates.map((d) => DB.getData(d)));

    const brandOf = (item) => {
      const m = item.deskripsi.match(/(?:NOTEBOOK|PC|LAPTOP)\s+([A-Za-z0-9]+)/i);
      if (m?.[1]) return m[1].toUpperCase();
      const t = (item.type || '').trim().split(/\s+/)[0];
      return t ? t.toUpperCase() : null;
    };

    const brands = {};
    histories.forEach((day, i) => {
      (day || []).forEach((item) => {
        const b = brandOf(item);
        if (!b) return;
        brands[b] = brands[b] || new Array(dates.length).fill(0);
        brands[b][i] += parseFloat(item.total) || 0;
      });
    });

    const KNOWN = {
      ACER: '#10b981', ASUS: '#1e3a8a', AXIOO: '#eab308',
      HP: '#38bdf8', LENOVO: '#ef4444', MSI: '#e2e8f0',
    };
    const PALETTE = ['#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#84cc16', '#6366f1', '#d946ef', '#64748b'];
    let pi = 0;

    const datasets = Object.keys(brands)
      .sort()
      .map((brand) => {
        const color = KNOWN[brand] || PALETTE[pi++ % PALETTE.length];
        return {
          label: brand,
          data: brands[brand],
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 6,
        };
      });

    const ctx = document.getElementById('brandChart');
    if (!ctx || typeof Chart === 'undefined') return;
    window.brandChartInstance?.destroy();

    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const text = css('--text-secondary');
    const gridColor = css('--border-color');

    window.brandChartInstance = new Chart(ctx.getContext('2d'), {
      type: 'line',
      data: { labels: dates.map((d) => formatDate(d)), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: text, font: { family: "'Inter',sans-serif", size: 11 }, boxWidth: 12, padding: 14 } },
          tooltip: { mode: 'index', intersect: false, backgroundColor: css('--bg-secondary'), titleColor: css('--text-primary'), bodyColor: text, borderColor: gridColor, borderWidth: 1 },
        },
        scales: {
          y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: text } },
          x: { grid: { color: gridColor }, ticks: { color: text } },
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
      },
    });
  },
};
