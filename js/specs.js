// ============================================================================
// specs.js — parse a supplier product description into structured fields.
// NOTEBOOK / PC titles get the full spec breakdown; accessories still get a
// sensible category + brand.
//
//   NOTEBOOK ASUS ROG STRIX G16 G614 INTEL CORE I7-14650HX 16GB 512GB
//   RTX4060 8GB 16" FHD+ IPS WIN11HOME OHS 1Y ADP GREY
//   MOUSE LOGITECH USB B100          -> category Mouse,  brand Logitech
//   PC LENOVO IDEACENTRE ...         -> category PC,     brand Lenovo
// ============================================================================

const CATEGORY_WORDS = new Set([
  'NOTEBOOK', 'LAPTOP', 'PC', 'AIO', 'DESKTOP', 'MINIPC', 'TABLET', 'HANDHELD',
  'MONITOR', 'MOUSE', 'KEYBOARD', 'KEYSET', 'HEADSET', 'HEADPHONE', 'EARPHONE',
  'SPEAKER', 'SOUNDBAR', 'ADAPTER', 'ADAPTOR', 'CHARGER', 'POWERBANK', 'BAG',
  'TAS', 'SLEEVE', 'KABEL', 'CABLE', 'DOCK', 'DOCKING', 'HUB', 'WEBCAM',
  'PRINTER', 'SCANNER', 'PROJECTOR', 'UPS', 'STABILIZER', 'SSD', 'HDD', 'NVME',
  'RAM', 'MEMORY', 'FLASHDISK', 'FLASHDRIVE', 'ROUTER', 'SWITCH', 'MOUSEPAD',
  'COOLINGPAD', 'COOLER', 'STAND', 'GAMEPAD', 'JOYSTICK', 'CONSOLE', 'SOFTWARE',
  'LICENSE', 'LISENSI', 'VOUCHER', 'ACCESSORIES', 'ACC', 'PEN', 'STYLUS',
]);

const KNOWN_BRANDS = new Set([
  'ASUS', 'ACER', 'LENOVO', 'HP', 'DELL', 'MSI', 'AXIOO', 'APPLE', 'MICROSOFT',
  'SAMSUNG', 'HUAWEI', 'XIAOMI', 'REDMI', 'INFINIX', 'REALME', 'ADVAN', 'ZYREX',
  'GIGABYTE', 'RAZER', 'LOGITECH', 'LOGITECH-G', 'VIVAN', 'ROBOT', 'NYK', 'RAPOO',
  'FANTECH', 'ARMAGGEDDON', 'REXUS', 'IMPERION', 'DIGITAL-ALLIANCE', 'VENOM',
  'CORSAIR', 'KINGSTON', 'SANDISK', 'ADATA', 'TEAMGROUP', 'PNY', 'WD', 'SEAGATE',
  'SILICONPOWER', 'SPC', 'LG', 'BENQ', 'VIEWSONIC', 'AOC', 'ZOTAC', 'PALIT',
  'GALAX', 'INNO3D', 'JBL', 'SONY', 'EDIFIER', 'STEELSERIES', 'ANKER', 'UGREEN',
  'BASEUS', 'TPLINK', 'TP-LINK', 'DLINK', 'D-LINK', 'MIKROTIK', 'PROLINK',
  'EPSON', 'CANON', 'BROTHER', 'ICA', 'PROLiNK', 'APC', 'COOLERMASTER', 'NZXT',
  'THERMALTAKE', 'DEEPCOOL', 'ROG', 'PREDATOR', 'NITRO', 'LEGION', 'OMEN',
]);

const BRAND_DISPLAY = {
  ASUS: 'ASUS', ACER: 'Acer', LENOVO: 'Lenovo', HP: 'HP', DELL: 'Dell',
  MSI: 'MSI', AXIOO: 'Axioo', APPLE: 'Apple', MICROSOFT: 'Microsoft',
  SAMSUNG: 'Samsung', HUAWEI: 'Huawei', XIAOMI: 'Xiaomi', INFINIX: 'Infinix',
  ADVAN: 'Advan', ZYREX: 'Zyrex', LOGITECH: 'Logitech', VIVAN: 'Vivan',
  GIGABYTE: 'Gigabyte', RAZER: 'Razer',
};

const CPU_ANCHOR = /\b(INTEL|AMD|SNAPDRAGON|QUALCOMM|APPLE)\b/;
const RAM_RE = /\b(\d+)(?:\+(\d+))?\s?GB\b/;
const STORAGE_RE = /\b(\d+)(?:\+(\d+))?\s?(GB|TB)\b/;
const GPU_RE = /\b(RTX|GTX|RX)\s?(\d{3,5})\s?(TI)?\s+(\d+)\s?GB\b/i;
const SCREEN_RE = /\b(\d{1,2}(?:[.,]\d)?)\s?"/;
const RES_RE = /\b(WQXGA\+|WQXGA|WUXGA|FHD\+|FHD|QHD\+|QHD|UHD|4K|3\.2K|2\.8K|2\.5K|2\.2K|2K|3K)(?=\s|"|$)/;
const PANEL_RE = /\b(MINI ?LED|POLED|OLED|IPS|TN|VA)\b/;
const OS_RE = /\b(WIN ?11 ?HOME|WIN ?11 ?PRO|WIN ?11|WIN ?10 ?HOME|WIN ?10 ?PRO|WIN ?10|FREE ?DOS|NON ?OS|DOS)\b/;
const BUNDLE_RE = /\b(OHS\+M365|OH\+M365|OHS|OH)\b/;
const WARRANTY_RE = /\b(\d+)\s?Y(\s?\+?\s?(?:ADP|NYVIP|\d*\s?Y?VIP))?\b/;

const OS_LABEL = {
  WIN11HOME: 'Windows 11 Home', WIN11PRO: 'Windows 11 Pro', WIN11: 'Windows 11',
  WIN10HOME: 'Windows 10 Home', WIN10PRO: 'Windows 10 Pro', WIN10: 'Windows 10',
  FREEDOS: 'FreeDOS', DOS: 'DOS', NONOS: 'Non OS',
};

function titleCase(s) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function brandDisplay(b) {
  return BRAND_DISPLAY[b] || (b.length <= 3 ? b : titleCase(b));
}

// Short CPU family used for the price-list facet: "AMD R5", "Intel Core Ultra 5"…
export function cpuFamily(processor) {
  if (!processor) return null;
  const p = processor.toUpperCase();
  let m;
  if ((m = p.match(/\bR(\d)\b/)) || (m = p.match(/RYZEN\s+(\d)/))) return `AMD R${m[1]}`;
  if ((m = p.match(/ULTRA\s+(\d)/))) return `Intel Core Ultra ${m[1]}`;
  if ((m = p.match(/CORE\s+(\d)\b/))) return `Intel Core ${m[1]}`;
  if ((m = p.match(/\bI(\d)-/)) || (m = p.match(/\bI(\d)\b/))) return `Intel Core i${m[1]}`;
  if (/\bN\d{3,4}\b|CELERON|PENTIUM/.test(p)) return 'Intel Entry';
  if (/SNAPDRAGON/.test(p)) return 'Snapdragon';
  if (/AMD/.test(p)) return 'AMD lainnya';
  if (/INTEL/.test(p)) return 'Intel lainnya';
  return 'Lainnya';
}

export function parseNotebookTitle(input) {
  const out = {
    isNotebook: false, category: null, notes: null, brand: null, model: null,
    processor: null, cpuFamily: null, ramGB: null, storageGB: null, gpu: null,
    gpuType: null, screen: null, resolution: null, panel: null, touch: false,
    os: null, bundle: null, warranty: null, color: null,
  };
  if (!input) return out;

  let text = String(input).trim().toUpperCase().replace(/\s+/g, ' ');
  out.isNotebook = /^NOTEBOOK\b/.test(text);

  const dash = text.indexOf(' - ');
  if (dash !== -1) {
    out.notes = titleCase(text.slice(dash + 3));
    text = text.slice(0, dash).trim();
  }

  const tokens = text.split(' ');

  // Category = leading word if it is a known product category.
  let idx = 0;
  if (CATEGORY_WORDS.has(tokens[0])) {
    out.category = titleCase(tokens[0]).replace('Pc', 'PC').replace('Aio', 'AIO');
    idx = 1;
  }

  // Brand = first known brand within the next few tokens, else the token itself.
  let brandTok = null;
  for (let i = idx; i < Math.min(tokens.length, idx + 4); i++) {
    if (KNOWN_BRANDS.has(tokens[i])) { brandTok = tokens[i]; idx = i; break; }
  }
  if (!brandTok) { brandTok = tokens[idx] || null; }
  out.brand = brandTok ? brandDisplay(brandTok) : null;
  if (!out.category && out.isNotebook) out.category = 'Notebook';

  let rest = tokens.slice(idx + 1).join(' ');

  const cpu = rest.match(CPU_ANCHOR);
  if (!cpu) {
    out.model = rest.trim() || null;
    return out;
  }
  out.model = rest.slice(0, cpu.index).trim() || null;

  const afterCpu = rest.slice(cpu.index);
  const ram = afterCpu.match(RAM_RE);
  if (!ram) {
    out.processor = titleCase(afterCpu);
    out.cpuFamily = cpuFamily(out.processor);
    return out;
  }
  out.processor = titleCase(afterCpu.slice(0, ram.index).trim());
  out.cpuFamily = cpuFamily(out.processor);
  out.ramGB = Number(ram[1]) + (ram[2] ? Number(ram[2]) : 0);

  let tail = afterCpu.slice(ram.index + ram[0].length).trim();

  const st = tail.match(STORAGE_RE);
  if (st) {
    const base = Number(st[1]) + (st[2] ? Number(st[2]) : 0);
    out.storageGB = st[3] === 'TB' ? base * 1024 : base;
    tail = tail.slice(st.index + st[0].length).trim();
  }

  const gpu = tail.match(GPU_RE);
  if (gpu) {
    out.gpu = `${gpu[1].toUpperCase()}${gpu[2]}${gpu[3] ? ' Ti' : ''} ${gpu[4]}GB`;
    out.gpuType = 'Dedicated';
  } else {
    out.gpuType = 'Integrated';
  }

  const scr = tail.match(SCREEN_RE);
  if (scr) out.screen = scr[1].replace(',', '.') + '"';

  const res = tail.match(RES_RE);
  if (res) out.resolution = res[1];

  const panel = tail.match(PANEL_RE);
  if (panel) out.panel = panel[1].replace('MINILED', 'MINI LED');

  out.touch = /\bTOUCH\b/.test(tail);

  const os = tail.match(OS_RE);
  if (os) {
    const key = os[1].replace(/\s+/g, '');
    out.os = OS_LABEL[key] || titleCase(os[1]);
  }

  let end = os ? tail.slice(os.index + os[0].length).trim() : tail;
  const bundle = end.match(BUNDLE_RE);
  if (bundle) {
    out.bundle = bundle[1];
    end = end.slice(bundle.index + bundle[0].length).trim();
  }
  const war = end.match(WARRANTY_RE);
  if (war) {
    const extra = (war[2] || '').replace(/\s|\+/g, '');
    out.warranty = `${war[1]} Tahun${extra ? ` (${extra})` : ''}`;
    end = end.slice(war.index + war[0].length).trim();
  }
  if (end && !/\d{3,}/.test(end)) out.color = titleCase(end);
  return out;
}

export function specSummary(spec) {
  const parts = [];
  if (spec.processor) parts.push(spec.processor);
  if (spec.ramGB) parts.push(`${spec.ramGB}GB RAM`);
  if (spec.storageGB) parts.push(spec.storageGB >= 1024 ? `${spec.storageGB / 1024}TB` : `${spec.storageGB}GB`);
  if (spec.gpu) parts.push(spec.gpu);
  if (spec.screen) parts.push(spec.screen + (spec.resolution ? ` ${spec.resolution}` : ''));
  return parts.join(' · ');
}

export function specSearchText(spec) {
  return [
    spec.category, spec.brand, spec.model, spec.processor, spec.cpuFamily,
    spec.ramGB && spec.ramGB + 'gb', spec.storageGB, spec.gpu, spec.gpuType,
    spec.screen, spec.resolution, spec.panel, spec.os, spec.bundle, spec.color,
    spec.touch ? 'touch' : '',
  ].filter(Boolean).join(' ');
}
