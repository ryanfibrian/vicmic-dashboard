// ============================================================================
// pages/pricelist.js — the master price list: date picker, per-column filters,
// type-aware sorting, day-over-day deltas, cost-column toggle for sales, and
// an Excel export.
// ============================================================================

import { DB } from '../db.js';
import { Auth } from '../auth.js';
import { PriceCalc } from '../priceCalc.js';
import {
  formatNumber,
  formatCurrency,
  formatDate,
  escapeHtml,
  compareValues,
} from '../utils.js';
import { showToast, copyToClipboard } from '../ui.js';

const COLUMNS = [
  { key: 'no', label: 'No.', type: 'number', width: '52px' },
  { key: 'sku', label: 'SKU', type: 'text', optional: true, defaultHidden: true },
  { key: 'pn', label: 'PN', type: 'text', optional: true, defaultHidden: true },
  { key: 'type', label: 'Type', type: 'text', optional: true, defaultHidden: true },
  { key: 'deskripsi', label: 'Deskripsi / Nama Barang', type: 'text', cls: 'col-deskripsi', filterable: true },
  { key: 'total', label: 'Total', type: 'number', width: '84px', cls: 'col-stock num', filterable: true },
  { key: 'harco', label: 'Harco', type: 'number', width: '84px', cls: 'col-stock num', filterable: true },
  { key: 'serpong', label: 'Serpong', type: 'number', width: '92px', cls: 'col-serpong num', filterable: true },
  { key: 'distribusi', label: 'Distribusi', type: 'currency', cls: 'num', cost: true },
  { key: 'hargaOnline', label: 'Harga Online', type: 'currency', cls: 'num' },
  { key: 'hargaOffline', label: 'Harga Offline', type: 'currency', cls: 'num' },
  { key: 'srp', label: 'SRP', type: 'currency', cls: 'num' },
  { key: 'promo_sellout', label: 'Promo Sellout', type: 'text' },
];

const PREV_KEY = {
  distribusi: 'prevDistribusi',
  hargaOnline: 'prevHargaOnline',
  hargaOffline: 'prevHargaOffline',
  serpong: 'prevSerpong',
  harco: 'prevHarco',
  total: 'prevTotal',
};

export const PriceList = {
  data: [],
  filtered: [],
  sortColumn: 'no',
  sortDirection: 'asc',
  filters: {},
  costVisible: null, // resolved on first render from role
  hiddenOptional: new Set(['sku', 'pn', 'type']),
  _wired: false,

  toggleCost() {
    this.costVisible = !this.costVisible;
    const btn = document.getElementById('btn-toggle-distribusi');
    if (btn) btn.textContent = this.costVisible ? 'Sembunyikan Distribusi' : 'Tampilkan Distribusi';
    this.renderHeader();
    this.renderBody();
  },

  visibleColumns() {
    return COLUMNS.filter((c) => {
      if (c.optional && this.hiddenOptional.has(c.key)) return false;
      if (c.cost && !this.costVisible) return false;
      return true;
    });
  },

  async render() {
    if (this.costVisible === null) this.costVisible = !Auth.isSales();

    const dateSelect = document.getElementById('pricelist-date-select');
    if (!this._wired) {
      this._wired = true;
      dateSelect.addEventListener('change', () => this.render());
      document.getElementById('btn-export').addEventListener('click', () => this.exportToExcel());
      document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
        this.filters = {};
        this.renderHeader();
        this.applyFiltersAndSort();
      });
      const toggle = document.getElementById('btn-toggle-distribusi');
      toggle?.addEventListener('click', () => this.toggleCost());
    }

    let targetDate = dateSelect.value;
    if (!targetDate) {
      targetDate = (await DB.getAllDates())[0] || formatDate(new Date());
      dateSelect.value = targetDate;
    }

    const tbody = document.getElementById('pricelist-body');
    tbody.innerHTML = `<tr><td colspan="${this.visibleColumns().length}" class="cell-empty"><span class="spinner"></span> Memuat…</td></tr>`;

    let rawData = await DB.getData(targetDate);
    let actualDate = targetDate;
    let isFallback = false;
    if (!rawData) {
      const latest = await DB.getLatestData();
      if (latest) {
        rawData = latest.data;
        actualDate = latest.date;
        isFallback = true;
      } else {
        rawData = [];
      }
    }

    const prevObj = await DB.getPreviousData(actualDate);
    const prevMap = new Map();
    (prevObj?.data || []).forEach((p) => prevMap.set(p.deskripsi.toLowerCase(), p));

    document.getElementById('pricelist-date-display').innerHTML = `
      <span>Menampilkan <strong>${formatDate(actualDate)}${isFallback ? ' (terbaru)' : ''}</strong></span>
      <span class="sep">·</span>
      <span>Dibandingkan <strong>${prevObj ? formatDate(prevObj.date) : 'tidak ada'}</strong></span>`;

    this.data = rawData.map((p) => {
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
      };
    });

    this.renderHeader();
    this.applyFiltersAndSort();
  },

  renderHeader() {
    const headerRow = document.getElementById('pricelist-header-row');
    const filterRow = document.getElementById('pricelist-filter-row');
    headerRow.innerHTML = '';
    filterRow.innerHTML = '';

    this.visibleColumns().forEach((col) => {
      const th = document.createElement('th');
      th.textContent = col.label;
      if (col.cls) th.className = col.cls;
      if (col.width) th.style.width = col.width;
      th.tabIndex = 0;
      th.setAttribute('role', 'button');
      if (this.sortColumn === col.key) {
        th.dataset.sort = this.sortDirection;
        th.innerHTML += this.sortDirection === 'asc' ? ' <span class="sort-caret">▲</span>' : ' <span class="sort-caret">▼</span>';
      }
      const doSort = () => {
        if (this.sortColumn === col.key) {
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortColumn = col.key;
          this.sortDirection = 'asc';
        }
        this.applyFiltersAndSort();
        this.renderHeader();
      };
      th.addEventListener('click', doSort);
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          doSort();
        }
      });
      headerRow.appendChild(th);

      const fth = document.createElement('th');
      if (col.cls) fth.className = col.cls;
      if (col.filterable) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'input-field column-filter';
        input.placeholder = 'Filter…';
        input.value = this.filters[col.key] || '';
        input.addEventListener('input', (e) => {
          this.filters[col.key] = e.target.value;
          this.applyFiltersAndSort();
        });
        fth.appendChild(input);
      }
      filterRow.appendChild(fth);
    });
  },

  applyFiltersAndSort() {
    this.filtered = this.data.filter((item) => {
      for (const key in this.filters) {
        const raw = (this.filters[key] || '').toLowerCase().trim();
        if (!raw) continue;
        const value = String(item[key] ?? '').toLowerCase();
        const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
        if (!parts.every((p) => value.includes(p))) return false;
      }
      return true;
    });

    const col = COLUMNS.find((c) => c.key === this.sortColumn) || COLUMNS[0];
    this.filtered.sort((a, b) =>
      compareValues(a[this.sortColumn], b[this.sortColumn], col.type, this.sortDirection)
    );

    this.renderBody();
    this.renderMeta();
  },

  renderMeta() {
    const meta = document.getElementById('pricelist-count');
    if (!meta) return;
    const total = this.data.length;
    const shown = this.filtered.length;
    meta.textContent = shown === total ? `${total} barang` : `${shown} dari ${total} barang`;
    const clearBtn = document.getElementById('btn-clear-filters');
    if (clearBtn) clearBtn.hidden = !Object.values(this.filters).some(Boolean);
  },

  renderBody() {
    const tbody = document.getElementById('pricelist-body');
    const cols = this.visibleColumns();

    if (!this.filtered.length) {
      tbody.innerHTML = `<tr><td colspan="${cols.length}" class="cell-empty">${
        this.data.length ? 'Tidak ada baris yang cocok dengan filter' : 'Tidak ada data untuk tanggal ini'
      }</td></tr>`;
      return;
    }

    tbody.innerHTML = this.filtered
      .map((item) => '<tr>' + cols.map((col) => this.renderCell(item, col)).join('') + '</tr>')
      .join('');

    tbody.querySelectorAll('[data-copy]').forEach((btn) =>
      btn.addEventListener('click', () => copyToClipboard(btn.dataset.copy, 'Tersalin'))
    );
    tbody.querySelectorAll('[data-search]').forEach((btn) =>
      btn.addEventListener('click', () =>
        window.open('https://www.google.com/search?q=' + encodeURIComponent(btn.dataset.search), '_blank', 'noopener')
      )
    );
  },

  renderCell(item, col) {
    const cls = col.cls ? ` class="${col.cls}"` : '';
    let val = item[col.key];
    let display;

    if (col.type === 'currency') display = formatCurrency(val);
    else if (col.type === 'number') display = formatNumber(val);
    else display = escapeHtml(val);

    // Day-over-day delta badge for the numeric/currency columns.
    const prevKey = PREV_KEY[col.key];
    if (prevKey && item[prevKey] != null && (col.type === 'number' || col.type === 'currency')) {
      const prev = item[prevKey];
      if (val !== prev) {
        const up = val > prev;
        const diff = Math.abs(val - prev);
        const diffStr = col.type === 'currency' ? formatCurrency(diff) : formatNumber(diff);
        display = `<span class="delta ${up ? 'is-up' : 'is-down'}">${display}<small>${up ? '▲' : '▼'} ${diffStr}</small></span>`;
      }
    }

    if (col.key === 'deskripsi') {
      const badge = item.isNew ? '<span class="tag tag-new">BARU</span> ' : '';
      const priced = `${item.deskripsi} ${formatCurrency(item.hargaOnline || 0)}`;
      display = `${badge}${escapeHtml(item.deskripsi)}
        <span class="row-actions">
          <button class="btn-inline" data-search="${escapeHtml(item.deskripsi)}" title="Cari di Google" aria-label="Cari di Google">⌕</button>
          <button class="btn-inline" data-copy="${escapeHtml(priced)}" title="Salin nama + harga online" aria-label="Salin nama dan harga">⧉</button>
        </span>`;
    }

    return `<td${cls}>${display}</td>`;
  },

  exportToExcel() {
    if (!this.filtered.length) return showToast('Tidak ada data untuk diexport', 'error');

    const dateStr = document.getElementById('pricelist-date-select').value;
    const cols = this.visibleColumns();
    const exportData = this.filtered.map((item, index) => {
      const row = {};
      cols.forEach((col) => {
        row[col.label] = col.key === 'no' ? index + 1 : item[col.key];
      });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(exportData, { origin: 'A3' });
    XLSX.utils.sheet_add_aoa(ws, [[`MASTER DATA PRICELIST - ${formatDate(dateStr)}`]], { origin: 'A1' });

    const colCount = Object.keys(exportData[0] || {}).length;
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(colCount - 1, 0) } }];

    const range = XLSX.utils.decode_range(ws['!ref']);
    let maxDesc = 25;
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (!cell) continue;
        if (R === 0)
          cell.s = { font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1a2238' } }, alignment: { horizontal: 'center', vertical: 'center' } };
        if (R === 2)
          cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '2a3754' } }, alignment: { horizontal: 'center', vertical: 'center' } };
        const header = ws[XLSX.utils.encode_cell({ r: 2, c: C })];
        if (header?.v === 'Deskripsi / Nama Barang' && R >= 3 && cell.v)
          maxDesc = Math.max(maxDesc, String(cell.v).length);
        if (R >= 3 && cell.t === 'n' && header) {
          const h = String(header.v);
          if (h.includes('Harga') || ['Distribusi', 'SRP', 'Total', 'Harco', 'Serpong'].includes(h)) cell.z = '#,##0';
        }
      }
    }

    ws['!cols'] = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
      const header = ws[XLSX.utils.encode_cell({ r: 2, c: C })];
      const v = header ? String(header.v) : '';
      if (v === 'No.') ws['!cols'].push({ wch: 5 });
      else if (v === 'Deskripsi / Nama Barang') ws['!cols'].push({ wch: Math.min(maxDesc + 2, 120) });
      else if (v.includes('Harga') || v === 'Distribusi' || v === 'SRP') ws['!cols'].push({ wch: 15 });
      else ws['!cols'].push({ wch: 10 });
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PriceList');
    XLSX.writeFile(wb, `Vicmic_PriceList_${dateStr}.xlsx`);
  },
};
