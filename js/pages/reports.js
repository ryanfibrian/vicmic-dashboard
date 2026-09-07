// ============================================================================
// pages/reports.js — daily "new items" and "out of stock / disappeared" lists,
// computed against the previous available date.
// ============================================================================

import { DB } from '../db.js';
import { formatDate, escapeHtml } from '../utils.js';
import { showLoading } from '../ui.js';

export const Reports = {
  _wired: false,

  async render() {
    const dateStr = (await DB.getAllDates())[0] || formatDate(new Date());
    document.getElementById('reports-date-label').textContent = formatDate(dateStr);

    showLoading(document.querySelector('#new-items-table tbody'), 'Memuat…');

    const [dataObj, prevObj] = await Promise.all([
      DB.getData(dateStr),
      DB.getPreviousData(dateStr),
    ]);
    const data = dataObj || [];
    const prevData = prevObj?.data || [];

    this.renderNewItems(data, prevData);
    this.renderOutOfStock(data, prevData);

    if (!this._wired) {
      this._wired = true;
      document.querySelectorAll('.report-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.report-tab').forEach((t) => t.classList.toggle('active', t === tab));
          document.querySelectorAll('.report-content').forEach((c) => c.classList.remove('active'));
          document.getElementById(tab.dataset.tab === 'new' ? 'report-new-items' : 'report-out-of-stock').classList.add('active');
        });
      });
    }
  },

  renderNewItems(data, prevData) {
    const prevSet = new Set(prevData.map((p) => p.deskripsi.toLowerCase()));
    const items = data.filter((p) => !prevSet.has(p.deskripsi.toLowerCase()));

    document.querySelector('#new-items-table thead tr').innerHTML = `
      <th style="width:52px">No.</th>
      <th class="col-deskripsi">Nama Barang (Baru)</th>
      <th class="num" style="width:110px">Stok Total</th>`;

    const tbody = document.querySelector('#new-items-table tbody');
    tbody.innerHTML = items.length
      ? items
          .map(
            (item, i) => `
        <tr>
          <td>${i + 1}</td>
          <td class="col-deskripsi"><span class="tag tag-new">BARU</span> ${escapeHtml(item.deskripsi)}</td>
          <td class="num">${item.total || 0}</td>
        </tr>`
          )
          .join('')
      : '<tr><td colspan="3" class="cell-empty">Tidak ada barang baru hari ini</td></tr>';
  },

  renderOutOfStock(data, prevData) {
    const currSet = new Set(data.map((p) => p.deskripsi.toLowerCase()));
    const items = prevData.filter((p) => !currSet.has(p.deskripsi.toLowerCase()));

    document.querySelector('#oos-table thead tr').innerHTML = `
      <th style="width:52px">No.</th>
      <th class="col-deskripsi">Nama Barang (Habis / Hilang)</th>`;

    const tbody = document.querySelector('#oos-table tbody');
    tbody.innerHTML = items.length
      ? items
          .map(
            (item, i) => `
        <tr class="row-danger">
          <td>${i + 1}</td>
          <td class="col-deskripsi">${escapeHtml(item.deskripsi)}</td>
        </tr>`
          )
          .join('')
      : '<tr><td colspan="2" class="cell-empty">Tidak ada barang yang habis / hilang hari ini</td></tr>';
  },
};
