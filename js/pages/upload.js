// ============================================================================
// pages/upload.js — admin uploads a daily price-list workbook; shows and prunes
// the upload history (backed by the data_uploads table).
// ============================================================================

import { DB } from '../db.js';
import { Auth } from '../auth.js';
import { ExcelParser } from '../excel.js';
import { formatDate, isSunday, todayKey, escapeHtml } from '../utils.js';
import { showToast, confirmModal, BTN_SPINNER } from '../ui.js';
import { Dashboard } from './dashboard.js';

export const Upload = {
  selectedFile: null,
  _wired: false,

  async render() {
    document.getElementById('upload-date').value = todayKey();
    this.wire();
    await this.renderHistory();
  },

  wire() {
    if (this._wired) return;
    this._wired = true;

    const dropzone = document.getElementById('upload-dropzone');
    const fileInput = document.getElementById('file-input');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    ['dragleave', 'drop'].forEach((ev) =>
      dropzone.addEventListener(ev, () => dropzone.classList.remove('drag-over'))
    );
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) this.onFileSelected(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) this.onFileSelected(e.target.files[0]);
    });

    document.getElementById('btn-upload').addEventListener('click', () => this.processUpload());
    document.getElementById('btn-filter-history').addEventListener('click', () => this.renderHistory());
    document.getElementById('btn-reset-history').addEventListener('click', () => {
      document.getElementById('filter-start-date').value = '';
      document.getElementById('filter-end-date').value = '';
      this.renderHistory();
    });
  },

  onFileSelected(file) {
    this.selectedFile = file;
    document.getElementById('upload-status').innerHTML =
      `<span class="ok">File terpilih: ${escapeHtml(file.name)}</span>`;
    document.getElementById('btn-upload').disabled = false;
  },

  async processUpload() {
    const dateStr = document.getElementById('upload-date').value;
    const btn = document.getElementById('btn-upload');
    const status = document.getElementById('upload-status');

    if (!dateStr) return showToast('Pilih tanggal berlaku', 'error');
    if (isSunday(dateStr)) return showToast('Tidak bisa upload untuk hari Minggu', 'error');
    if (!this.selectedFile) return showToast('Pilih file terlebih dahulu', 'error');

    const existing = await DB.getData(dateStr);
    if (existing) {
      const ok = await confirmModal({
        title: 'Timpa data tanggal ini?',
        message: `Sudah ada ${existing.length} baris untuk <strong>${formatDate(dateStr)}</strong>. Upload akan mengganti semuanya.`,
        confirmText: 'Timpa',
        danger: true,
      });
      if (!ok) return;
    }

    try {
      btn.disabled = true;
      btn.innerHTML = `${BTN_SPINNER} Memproses…`;
      status.innerHTML = 'Memproses…';

      const products = await ExcelParser.parse(this.selectedFile);
      if (!products.length) throw new Error('Tidak ada baris produk yang valid di file');

      await DB.saveData(dateStr, products, {
        filename: this.selectedFile.name,
        uploadedBy: Auth.currentUser?.email,
      });

      showToast(`Berhasil menyimpan ${products.length} produk`, 'success');
      status.innerHTML = '';
      this.selectedFile = null;
      document.getElementById('file-input').value = '';
      await this.renderHistory();
    } catch (err) {
      const msg = err.message || String(err);
      showToast(msg, 'error');
      status.innerHTML = `<span class="err">${escapeHtml(msg)}</span>`;
    } finally {
      btn.disabled = !this.selectedFile;
      btn.textContent = 'Upload & Proses';
    }
  },

  async renderHistory() {
    const tbody = document.getElementById('upload-history-body');
    tbody.innerHTML = '<tr><td colspan="5" class="cell-empty"><span class="spinner"></span> Memuat riwayat…</td></tr>';

    try {
      const start = document.getElementById('filter-start-date').value;
      const end = document.getElementById('filter-end-date').value;

      const [dates, uploads] = await Promise.all([DB.getAllDates(), DB.getUploads()]);
      const uploadByDate = new Map(uploads.map((u) => [u.date, u]));

      let list = dates;
      if (start) list = list.filter((d) => d >= start);
      if (end) list = list.filter((d) => d <= end);

      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="cell-empty">Belum ada data yang diupload</td></tr>';
        return;
      }

      tbody.innerHTML = list
        .map((date) => {
          const meta = uploadByDate.get(date);
          return `
        <tr data-date="${date}">
          <td><input type="checkbox" class="row-check" aria-label="Pilih ${formatDate(date)}"></td>
          <td>${formatDate(date)}</td>
          <td class="text-muted">${meta?.filename ? escapeHtml(meta.filename) : '—'}${
            meta?.row_count ? ` <span class="text-muted">(${meta.row_count})</span>` : ''
          }</td>
          <td><span class="tag tag-success">Tersedia</span></td>
          <td class="table-actions"><button class="btn btn-sm btn-danger" data-action="delete">Hapus</button></td>
        </tr>`;
        })
        .join('');

      this.wireHistoryControls();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="cell-empty err">Gagal memuat riwayat: ${escapeHtml(err.message)}</td></tr>`;
    }
  },

  wireHistoryControls() {
    const checks = [...document.querySelectorAll('#upload-history-body .row-check')];
    const selectAll = document.getElementById('chk-select-all');
    const bulkBtn = document.getElementById('btn-bulk-delete');

    const sync = () => {
      const anyChecked = checks.some((c) => c.checked);
      bulkBtn.hidden = !anyChecked;
      if (selectAll) selectAll.checked = anyChecked && checks.every((c) => c.checked);
    };

    if (selectAll) {
      selectAll.checked = false;
      selectAll.onchange = () => {
        checks.forEach((c) => (c.checked = selectAll.checked));
        sync();
      };
    }
    checks.forEach((c) => (c.onchange = sync));
    sync();

    bulkBtn.onclick = async () => {
      const dates = checks.filter((c) => c.checked).map((c) => c.closest('tr').dataset.date);
      if (!dates.length) return;
      const ok = await confirmModal({
        title: `Hapus ${dates.length} tanggal?`,
        message: 'Semua data harga untuk tanggal terpilih dihapus permanen.',
        confirmText: 'Hapus semua',
        danger: true,
        countdown: 3,
      });
      if (!ok) return;
      bulkBtn.disabled = true;
      try {
        for (const d of dates) await DB.deleteData(d);
        showToast(`${dates.length} tanggal dihapus`, 'success');
        await this.renderHistory();
        await Dashboard.render().catch(() => {});
      } catch (err) {
        showToast('Sebagian gagal dihapus: ' + err.message, 'error');
      } finally {
        bulkBtn.disabled = false;
      }
    };

    document.querySelectorAll('#upload-history-body button[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const date = btn.closest('tr').dataset.date;
        const ok = await confirmModal({
          title: 'Hapus data tanggal ini?',
          message: `Semua data harga untuk <strong>${formatDate(date)}</strong> dihapus permanen.`,
          confirmText: 'Hapus',
          danger: true,
          countdown: 3,
        });
        if (!ok) return;
        btn.disabled = true;
        btn.innerHTML = BTN_SPINNER;
        try {
          await DB.deleteData(date);
          showToast(`Data ${formatDate(date)} dihapus`, 'success');
          await this.renderHistory();
          await Dashboard.render().catch(() => {});
        } catch (err) {
          showToast('Gagal menghapus: ' + err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Hapus';
        }
      });
    });
  },
};
