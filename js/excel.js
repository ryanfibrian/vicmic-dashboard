// ============================================================================
// excel.js — parse an uploaded price-list workbook into product rows, with a
// fallback "map these columns" modal when auto-detection misses a field.
// ============================================================================

import { CONFIG } from './config.js';
import { showModal, hideModal, showToast } from './ui.js';
import { escapeHtml } from './utils.js';

const FIELD_LABELS = {
  distribusi: 'Harga Distribusi',
  serpong: 'Stok Serpong',
  harco: 'Stok Harco',
  total: 'Total Stok',
  deskripsi: 'Deskripsi / Nama Barang',
};

export const ExcelParser = {
  parse(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Gagal membaca file'));
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          if (!json.length) return reject(new Error('File Excel kosong'));

          const headers = Object.keys(json[0]);
          const mapping = this.autoMapColumns(headers);
          const missingRequired = CONFIG.REQUIRED_COLUMNS.filter((c) => !mapping.mapped[c]);

          if (missingRequired.length) {
            this.showMappingModal(
              headers,
              mapping,
              (finalMapping) => resolve(this.extractProducts(json, finalMapping)),
              reject
            );
          } else {
            resolve(this.extractProducts(json, mapping.mapped));
          }
        } catch (err) {
          reject(new Error('Error parsing Excel: ' + err.message));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  },

  autoMapColumns(headers) {
    const mapped = {};
    const unmapped = [];
    for (const [field, aliases] of Object.entries(CONFIG.COLUMN_ALIASES)) {
      const match = headers.find((h) =>
        aliases.some((a) => h.toLowerCase().trim().includes(a.toLowerCase()))
      );
      if (match) mapped[field] = match;
      else unmapped.push(field);
    }
    return { mapped, unmapped };
  },

  showMappingModal(headers, partial, onSuccess, onReject) {
    const mapped = { ...partial.mapped };
    const needed = partial.unmapped.filter((f) => CONFIG.REQUIRED_COLUMNS.includes(f));

    const options = headers.map((h) => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join('');
    const rows = needed
      .map(
        (field) => `
        <div class="form-group">
          <label class="form-label">${FIELD_LABELS[field] || field}</label>
          <select class="input-field mapping-select" data-field="${field}">
            <option value="">— pilih kolom —</option>${options}
          </select>
        </div>`
      )
      .join('');

    showModal(
      'Petakan Kolom',
      `<p class="modal-message">Beberapa kolom wajib tidak terdeteksi otomatis. Pilih kolom yang sesuai:</p>${rows}`,
      [
        { text: 'Batal', class: 'btn-secondary', onClick: () => { hideModal(); onReject(new Error('Upload dibatalkan')); } },
        {
          text: 'Konfirmasi',
          class: 'btn-primary',
          onClick: () => {
            document.querySelectorAll('.mapping-select').forEach((sel) => {
              if (sel.value) mapped[sel.dataset.field] = sel.value;
            });
            const still = CONFIG.REQUIRED_COLUMNS.filter((c) => !mapped[c]);
            if (still.length) return showToast('Semua kolom wajib harus dipetakan', 'error');
            hideModal();
            onSuccess(mapped);
          },
        },
      ]
    );
  },

  extractProducts(json, mapping) {
    const int = (v) => parseInt(String(v).replace(/[^0-9-]/g, ''), 10) || 0;
    const num = (v) => parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0;
    const str = (v) => String(v ?? '').trim();

    return json
      .map((row, i) => ({
        no: i + 1,
        sku: str(row[mapping.sku]),
        pn: str(row[mapping.pn]),
        type: str(row[mapping.type]),
        deskripsi: str(row[mapping.deskripsi]),
        distribusi: num(row[mapping.distribusi]),
        serpong: int(row[mapping.serpong]),
        harco: int(row[mapping.harco]),
        total: int(row[mapping.total]),
        srp: num(row[mapping.srp]),
        promo_sellout: str(row[mapping.promo_sellout]),
      }))
      .filter((p) => p.deskripsi !== '');
  },
};
