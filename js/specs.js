// ============================================================================
// specs.js — parse a supplier NOTEBOOK description string into structured
// fields, ported from PricelistImportParser::parseTitle (PHP).
//
// Best-effort and fully nullable: real titles have exceptions, so every field
// may come back null. Used to show a spec chip row in the price list and to
// enrich search — never to overwrite stored data.
//
//   NOTEBOOK ASUS ROG STRIX G16 G614 INTEL CORE I7-14650HX 16GB 512GB
//   RTX4060 8GB 16" FHD+ IPS 165HZ WIN11HOME OHS 1Y ADP GREY
// ============================================================================

const CPU_ANCHOR = /\b(INTEL|AMD|SNAPDRAGON|QUALCOMM|APPLE)\b/;
const RAM_RE = /\b(\d+)(?:\+(\d+))?\s?GB\b/;
const STORAGE_RE = /\b(\d+)(?:\+(\d+))?\s?(GB|TB)\b/;
const GPU_RE = /\b(RTX|GTX|RX)\s?(\d{3,5})\s?(TI)?\s+(\d+)\s?GB\b/i;
const SCREEN_RE = /\b(\d{2}(?:[.,]\d)?)\s?"/;
const RES_RE = /\b(WQXGA\+|WQXGA|WUXGA|FHD\+|FHD|QHD\+|QHD|UHD|4K|3\.2K|2\.8K|2\.5K|2\.2K|2K|3K)(?=\s|"|$)/;
const PANEL_RE = /\b(MINI ?LED|POLED|OLED|IPS|TN|VA)\b/;
const OS_RE = /\b(WIN ?11 ?HOME|WIN ?11 ?PRO|WIN ?11|WIN ?10 ?HOME|WIN ?10 ?PRO|WIN ?10|FREE ?DOS|NON ?OS|DOS)\b/;
const BUNDLE_RE = /\b(OHS\+M365|OH\+M365|OHS|OH)\b/;
const WARRANTY_RE = /\b(\d+)\s?Y(\s?\+?\s?(?:ADP|NYVIP|\d*\s?Y?VIP))?\b/;

const OS_LABEL = {
  WIN11HOME: 'Windows 11 Home',
  WIN11PRO: 'Windows 11 Pro',
  WIN11: 'Windows 11',
  WIN10HOME: 'Windows 10 Home',
  WIN10PRO: 'Windows 10 Pro',
  WIN10: 'Windows 10',
  FREEDOS: 'FreeDOS',
  DOS: 'DOS',
  NONOS: 'Non OS',
};

function titleCase(s) {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function parseNotebookTitle(input) {
  const empty = {
    isNotebook: false, notes: null, brand: null, model: null, processor: null,
    ramGB: null, storageGB: null, gpu: null, gpuType: null, screen: null,
    resolution: null, panel: null, touch: false, os: null, bundle: null,
    warranty: null, color: null,
  };
  if (!input) return empty;

  let text = String(input).trim().toUpperCase().replace(/\s+/g, ' ');
  const out = { ...empty };
  out.isNotebook = /^NOTEBOOK\b/.test(text);

  // Trailing " - note".
  const dash = text.indexOf(' - ');
  if (dash !== -1) {
    out.notes = titleCase(text.slice(dash + 3));
    text = text.slice(0, dash).trim();
  }

  text = text.replace(/^NOTEBOOK\s+/, '');

  const cpu = text.match(CPU_ANCHOR);
  if (!cpu) {
    out.brand = text.split(' ')[0] || null;
    out.model = text.slice((out.brand || '').length).trim() || null;
    return out;
  }

  out.brand = text.slice(0, cpu.index).trim().split(' ')[0] || null;
  out.model = text.slice((out.brand || '').length, cpu.index).trim() || null;

  const afterCpu = text.slice(cpu.index);
  const ram = afterCpu.match(RAM_RE);
  if (!ram) {
    out.processor = titleCase(afterCpu);
    return out;
  }
  out.processor = titleCase(afterCpu.slice(0, ram.index).trim());
  out.ramGB = Number(ram[1]) + (ram[2] ? Number(ram[2]) : 0);

  let rest = afterCpu.slice(ram.index + ram[0].length).trim();

  const st = rest.match(STORAGE_RE);
  if (st) {
    const base = Number(st[1]) + (st[2] ? Number(st[2]) : 0);
    out.storageGB = st[3] === 'TB' ? base * 1024 : base;
    rest = rest.slice(st.index + st[0].length).trim();
  }

  const gpu = rest.match(GPU_RE);
  if (gpu) {
    out.gpu = `${gpu[1].toUpperCase()}${gpu[2]}${gpu[3] ? ' Ti' : ''} ${gpu[4]}GB`;
    out.gpuType = 'Dedicated';
  } else {
    out.gpuType = 'Integrated';
  }

  const scr = rest.match(SCREEN_RE);
  if (scr) out.screen = scr[1].replace(',', '.') + '"';

  const res = rest.match(RES_RE);
  if (res) out.resolution = res[1];

  const panel = rest.match(PANEL_RE);
  if (panel) out.panel = panel[1].replace('MINILED', 'MINI LED');

  out.touch = /\bTOUCH\b/.test(rest);

  const os = rest.match(OS_RE);
  if (os) {
    const key = os[1].replace(/\s+/g, '');
    out.os = OS_LABEL[key] || titleCase(os[1]);
  }

  let tail = os ? rest.slice(os.index + os[0].length).trim() : rest;

  const bundle = tail.match(BUNDLE_RE);
  if (bundle) {
    out.bundle = bundle[1];
    tail = tail.slice(bundle.index + bundle[0].length).trim();
  }

  const war = tail.match(WARRANTY_RE);
  if (war) {
    const extra = (war[2] || '').replace(/\s|\+/g, '');
    out.warranty = `${war[1]} Tahun${extra ? ` (${extra})` : ''}`;
    tail = tail.slice(war.index + war[0].length).trim();
  }

  if (tail && !/\d{3,}/.test(tail)) out.color = titleCase(tail);
  return out;
}

// Compact "Brand · Prosesor · RAM · …" summary line.
export function specSummary(spec) {
  const parts = [];
  if (spec.processor) parts.push(spec.processor);
  if (spec.ramGB) parts.push(`${spec.ramGB}GB RAM`);
  if (spec.storageGB)
    parts.push(spec.storageGB >= 1024 ? `${spec.storageGB / 1024}TB` : `${spec.storageGB}GB`);
  if (spec.gpu) parts.push(spec.gpu);
  if (spec.screen) parts.push(spec.screen + (spec.resolution ? ` ${spec.resolution}` : ''));
  return parts.join(' · ');
}

// Text blob for search matching.
export function specSearchText(spec) {
  return [
    spec.brand, spec.model, spec.processor, spec.ramGB && spec.ramGB + 'gb',
    spec.storageGB, spec.gpu, spec.gpuType, spec.screen, spec.resolution,
    spec.panel, spec.os, spec.bundle, spec.color, spec.touch ? 'touch' : '',
  ]
    .filter(Boolean)
    .join(' ');
}
