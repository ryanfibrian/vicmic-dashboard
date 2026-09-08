// ============================================================================
// utils.js — pure formatting / parsing helpers. No DOM, no network.
// ============================================================================

export function formatNumber(num) {
  return Number(num || 0).toLocaleString('id-ID');
}

export function formatCurrency(num) {
  return 'Rp ' + formatNumber(num);
}

const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d)) return String(dateStr);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
}

export function dateToKey(date) {
  // Local calendar date (not UTC) so an upload late at night keeps today's date.
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().split('T')[0];
}

export function todayKey() {
  return dateToKey(new Date());
}

export function isSunday(dateStr) {
  const d = new Date(dateStr);
  return d.getDay() === 0;
}

// Sunday has no fresh data — fall back to Saturday.
export function getEffectiveDate() {
  const today = new Date();
  if (today.getDay() === 0) today.setDate(today.getDate() - 1);
  return dateToKey(today);
}

export function decodeJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return {};
  }
}

// Escape a string for safe interpolation into innerHTML.
export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Type-aware comparator for table sorting. `type` is 'number' | 'currency' | 'text'.
export function compareValues(a, b, type, direction = 'asc') {
  const dir = direction === 'asc' ? 1 : -1;
  let va = a;
  let vb = b;

  if (type === 'number' || type === 'currency') {
    va = Number(va) || 0;
    vb = Number(vb) || 0;
  } else {
    va = String(va ?? '').toLowerCase();
    vb = String(vb ?? '').toLowerCase();
  }

  if (va < vb) return -1 * dir;
  if (va > vb) return 1 * dir;
  return 0;
}

// "5,5" (Indonesian decimal) or "5.5" -> 5.5
export function parseDecimalId(raw) {
  return parseFloat(String(raw ?? '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
