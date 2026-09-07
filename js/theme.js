// ============================================================================
// theme.js — light / dark toggle. Persists to localStorage, reflects the choice
// on <html data-theme> and in <meta name="theme-color">, and keeps any open
// chart in sync.
// ============================================================================

const KEY = 'vicmic_theme';
const THEMES = ['dark', 'light'];

const META_COLOR = { dark: '#0f172a', light: '#f1f5f9' };

export function getTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (THEMES.includes(saved)) return saved;
  } catch {}
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(theme) {
  const t = THEMES.includes(theme) ? theme : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_COLOR[t]);
  try {
    localStorage.setItem(KEY, t);
  } catch {}
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(t === 'light'));
    btn.dataset.theme = t;
    const label = btn.querySelector('.theme-toggle-label');
    // Label names the mode the button switches TO.
    if (label) label.textContent = t === 'light' ? 'Mode Gelap' : 'Mode Terang';
  });
  window.brandChartInstance?.destroy?.();
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t } }));
}

export function toggleTheme() {
  applyTheme(getTheme() === 'light' ? 'dark' : 'light');
}

// Apply as early as possible to avoid a flash.
export function initThemeEarly() {
  applyTheme(getTheme());
}

export function wireThemeToggles() {
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.addEventListener('click', toggleTheme);
  });
  applyTheme(getTheme());
}
