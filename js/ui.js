// ============================================================================
// ui.js — toast, modal, confirm dialog, and loading-state helpers.
// ============================================================================

const ICONS = { success: '✓', error: '✕', warning: '!', info: 'i' };

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${ICONS[type] || ICONS.info}</span><span class="toast-msg"></span>`;
  toast.querySelector('.toast-msg').textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

export function showModal(title, bodyHtml, buttons = []) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  const footer = document.getElementById('modal-footer');
  footer.innerHTML = '';
  buttons.forEach((btn) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `btn ${btn.class || 'btn-secondary'}`;
    el.textContent = btn.text;
    el.addEventListener('click', btn.onClick);
    footer.appendChild(el);
  });
  document.getElementById('modal-overlay').classList.add('show');
}

export function hideModal() {
  document.getElementById('modal-overlay').classList.remove('show');
}

// Promise-based replacement for window.confirm(). Resolves true/false.
// `danger: true` styles the confirm button as destructive and (optionally) adds
// a short countdown before it becomes clickable.
export function confirmModal({
  title = 'Konfirmasi',
  message = '',
  confirmText = 'Ya, lanjutkan',
  cancelText = 'Batal',
  danger = false,
  countdown = 0,
} = {}) {
  return new Promise((resolve) => {
    const bodyHtml = `<p class="modal-message">${message}</p>`;
    let timer = null;
    let remaining = countdown;

    const cleanup = (result) => {
      if (timer) clearInterval(timer);
      hideModal();
      resolve(result);
    };

    showModal(title, bodyHtml, [
      { text: cancelText, class: 'btn-secondary', onClick: () => cleanup(false) },
      {
        text: countdown > 0 ? `${confirmText} (${remaining})` : confirmText,
        class: danger ? 'btn-danger' : 'btn-primary',
        onClick: () => {
          if (remaining > 0) return;
          cleanup(true);
        },
      },
    ]);

    if (countdown > 0) {
      const confirmBtn = document.querySelector('#modal-footer .btn:last-child');
      confirmBtn.disabled = true;
      timer = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) {
          confirmBtn.textContent = `${confirmText} (${remaining})`;
        } else {
          clearInterval(timer);
          timer = null;
          confirmBtn.disabled = false;
          confirmBtn.textContent = confirmText;
        }
      }, 1000);
    }
  });
}

// Skeleton / spinner shown inside a container while its data loads.
export function showLoading(target, label = 'Memuat data…') {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;
  el.innerHTML = `
    <div class="loading-block">
      <span class="spinner" aria-hidden="true"></span>
      <span>${label}</span>
    </div>`;
}

// Small inline spinner string for buttons.
export const BTN_SPINNER = '<span class="spinner spinner-sm" aria-hidden="true"></span>';

export function copyToClipboard(text, okMessage = 'Tersalin') {
  return navigator.clipboard
    .writeText(text)
    .then(() => showToast(okMessage, 'success'))
    .catch(() => showToast('Gagal menyalin', 'error'));
}
