// Live market. Driven only by the market-source record; nothing here reads any other record.
import { countTo } from './motion.js';
import { reduced } from './spring.js';

const $ = (s, r = document) => r.querySelector(s);
const SRC = (() => { try { return JSON.parse($('#market-source').textContent); } catch { return {}; } })();

const POLL_MS = 60000;
const BACKOFF_BASE = 2000;
const BACKOFF_MAX = 60000;
const TIMEOUT_MS = 10000;
const TOP_N = 10;
const CHUNK = 30;

const ICON_COPY = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 9h10v11H9zM5 15V4h10"/></svg>';

const state = { rows: [], sort: 'volume', timer: 0, fails: 0, busy: false, el: new Map(), sig: '', hasData: false };

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export const fmtUsd = (n) => {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
export const fmtPrice = (p) => {
  if (!Number.isFinite(p) || p <= 0) return '—';
  if (p >= 1) return `$${p.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  return `$${p.toFixed(Math.min(12, 2 - Math.floor(Math.log10(p))))}`;
};
const fmtChg = (c) => `${c >= 0 ? '+' : ''}${c.toFixed(1)}%`;
const fmtInt = (n) => String(Math.round(n));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function getJSON(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`status ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function load() {
  if (!SRC.boosts || !SRC.pairs) throw new Error('no source');
  const boosts = await getJSON(SRC.boosts);
  const list = Array.isArray(boosts) ? boosts : [];
  const addrs = [...new Set(list.filter((b) => b && b.chainId === 'solana' && b.tokenAddress).map((b) => b.tokenAddress))];
  if (!addrs.length) throw new Error('empty');
  const pairs = [];
  for (let i = 0; i < addrs.length; i += CHUNK) {
    const part = await getJSON(SRC.pairs.replace('{addresses}', addrs.slice(i, i + CHUNK).join(',')));
    if (Array.isArray(part)) pairs.push(...part);
  }
  const by = new Map();
  for (const p of pairs) {
    if (!p || p.chainId !== 'solana' || !p.baseToken) continue;
    const a = p.baseToken.address; if (!addrs.includes(a)) continue;
    const liq = num(p.liquidity && p.liquidity.usd), vol = num(p.volume && p.volume.h24);
    const cur = by.get(a);
    if (!cur) by.set(a, { address: a, symbol: p.baseToken.symbol || '?', name: p.baseToken.name || '', image: p.info && p.info.imageUrl, price: num(p.priceUsd), change: num(p.priceChange && p.priceChange.h24), volume: vol, liquidity: liq, topLiq: liq });
    else {
      cur.volume += vol; cur.liquidity += liq;
      if (liq > cur.topLiq) { cur.topLiq = liq; cur.price = num(p.priceUsd); cur.change = num(p.priceChange && p.priceChange.h24); if (p.info && p.info.imageUrl) cur.image = p.info.imageUrl; }
      if (!cur.image && p.info && p.info.imageUrl) cur.image = p.info.imageUrl;
    }
  }
  const out = [...by.values()].sort((a, b) => b.volume - a.volume).slice(0, TOP_N);
  if (!out.length) throw new Error('no pairs');
  return out;
}

// ---------- view
function setStatus(kind, note) {
  const pill = $('[data-pill]'); pill.dataset.state = kind;
  $('[data-pill-text]').textContent = { live: 'Live', sync: 'Syncing', retry: 'Retrying', offline: 'Offline' }[kind];
  $('[data-status-note]').textContent = note;
}
function setErr(msg) { const e = $('[data-err]'); e.hidden = !msg; e.textContent = msg || ''; }

function skeletonRows() {
  const rows = $('[data-rows]');
  rows.setAttribute('aria-busy', 'true');
  rows.innerHTML = Array.from({ length: TOP_N }, () => '<li class="row"><span class="skel skel--cell" style="width:20px"></span><span class="row__token"><span class="skel skel--logo"></span><span class="skel skel--cell" style="width:110px"></span></span><span class="skel skel--cell"></span><span class="skel skel--cell"></span><span class="skel skel--cell"></span><span class="skel skel--cell"></span><span class="skel skel--copy"></span></li>').join('');
  $('[data-ticker-track]').innerHTML = Array.from({ length: 10 }, () => '<span class="tick tick--skel skel"></span>').join('');
}

function dashRows() {
  const rows = $('[data-rows]'); rows.setAttribute('aria-busy', 'false');
  rows.innerHTML = Array.from({ length: TOP_N }, (_, i) => `<li class="row"><span class="row__rank">${i + 1}</span><span class="row__token"><span class="logo">—</span><span class="row__name"><span class="row__sym">—</span></span></span><span class="row__price">—</span><span class="row__chg">—</span><span class="row__vol">—</span><span class="row__liq">—</span><span></span></li>`).join('');
  $('[data-ticker-track]').innerHTML = '<span class="tick">—</span>';
  for (const k of ['count', 'volume', 'liquidity', 'mover']) { const s = $(`[data-stat="${k}"]`); s.textContent = '—'; s._v = undefined; delete s.dataset.set; }
}

function logoEl(r) {
  const d = document.createElement('span'); d.className = 'logo';
  const letter = () => { d.textContent = (r.symbol || '?').trim().charAt(0).toUpperCase() || '?'; };
  if (r.image) {
    const img = new Image(); img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.decoding = 'async';
    img.onerror = () => { img.remove(); letter(); };
    img.src = r.image; d.appendChild(img);
  } else letter();
  return d;
}

function buildRow(r) {
  const li = document.createElement('li'); li.className = 'row'; li.dataset.addr = r.address;
  li.innerHTML = `<span class="row__rank"></span><span class="row__token"><span data-logo></span><span class="row__name"><span class="row__sym">${esc(r.symbol)}</span><span class="row__full">${esc(r.name)}</span></span></span><span class="row__price"><span class="row__k">Price</span><span data-c="price"></span></span><span class="row__chg"><span class="row__k">24h</span><span data-c="chg"></span></span><span class="row__vol"><span class="row__k">Volume</span><span data-c="vol"></span></span><span class="row__liq"><span class="row__k">Liquidity</span><span data-c="liq"></span></span><span class="row__copy"><button class="copy" type="button" data-copy="${esc(r.address)}" aria-label="Copy token address for ${esc(r.symbol)}">${ICON_COPY}</button></span>`;
  $('[data-logo]', li).replaceWith(logoEl(r));
  return li;
}

function sorted() {
  const k = { volume: 'volume', change: 'change', liquidity: 'liquidity' }[state.sort];
  return [...state.rows].sort((a, b) => b[k] - a[k]);
}

function render(first) {
  const rowsEl = $('[data-rows]');
  const list = sorted();
  const sig = state.rows.map((r) => r.address).sort().join();
  if (first || sig !== state.sig) {
    state.el.clear(); rowsEl.innerHTML = '';
    list.forEach((r, i) => { const li = buildRow(r); li.classList.add('in'); li.style.setProperty('--i', i); state.el.set(r.address, li); rowsEl.appendChild(li); });
    state.sig = sig;
    buildTicker();
  }
  rowsEl.setAttribute('aria-busy', 'false');
  list.forEach((r, i) => {
    const li = state.el.get(r.address); if (!li) return;
    if (rowsEl.children[i] !== li) rowsEl.insertBefore(li, rowsEl.children[i]);
    $('.row__rank', li).textContent = String(i + 1);
    const chg = $('[data-c="chg"]', li); chg.className = r.change >= 0 ? 'up' : 'down';
    countTo($('[data-c="price"]', li), r.price, fmtPrice);
    countTo(chg, r.change, fmtChg);
    countTo($('[data-c="vol"]', li), r.volume, fmtUsd);
    countTo($('[data-c="liq"]', li), r.liquidity, fmtUsd);
  });
  updateTicker();
  const lead = [...state.rows].sort((a, b) => b.change - a.change)[0];
  countTo($('[data-stat="count"]'), state.rows.length, fmtInt);
  countTo($('[data-stat="volume"]'), state.rows.reduce((s, r) => s + r.volume, 0), fmtUsd);
  countTo($('[data-stat="liquidity"]'), state.rows.reduce((s, r) => s + r.liquidity, 0), fmtUsd);
  const mv = $('[data-stat="mover"]'); const txt = `${lead.symbol} ${fmtChg(lead.change)}`;
  if (mv.textContent !== txt) { mv.textContent = txt; mv.closest('.stat').classList.remove('flash-up'); void mv.offsetWidth; mv.closest('.stat').classList.add('flash-up'); }
}

function tickHtml(r) {
  return `<span class="tick" data-k="${esc(r.address)}"><span class="tick__sym">${esc(r.symbol)}</span><span data-t="price">${fmtPrice(r.price)}</span><span data-t="chg" class="${r.change >= 0 ? 'up' : 'down'}">${fmtChg(r.change)}</span></span>`;
}
function buildTicker() {
  const t = $('[data-ticker-track]');
  const once = sorted().map(tickHtml).join('');
  t.innerHTML = reduced() ? once : once + once;
}
function updateTicker() {
  for (const r of state.rows) {
    document.querySelectorAll(`[data-ticker-track] [data-k="${CSS.escape(r.address)}"]`).forEach((n) => {
      $('[data-t="price"]', n).textContent = fmtPrice(r.price);
      const c = $('[data-t="chg"]', n); c.textContent = fmtChg(r.change); c.className = r.change >= 0 ? 'up' : 'down';
    });
  }
}

// ---------- loop
function schedule(ms) { clearTimeout(state.timer); if (!document.hidden) state.timer = setTimeout(tick, ms); }

async function tick() {
  if (state.busy || document.hidden) return;
  state.busy = true;
  setStatus('sync', state.hasData ? 'Refreshing' : 'Contacting the feed');
  try {
    const rows = await load();
    const first = !state.hasData;
    state.rows = rows; state.hasData = true; state.fails = 0;
    render(first);
    setErr('');
    setStatus('live', 'Refreshes each minute');
    schedule(POLL_MS);
  } catch {
    state.fails += 1;
    const wait = Math.min(BACKOFF_MAX, BACKOFF_BASE * 2 ** (state.fails - 1));
    setErr('Feed unreachable, trying again shortly.');
    if (!state.hasData) { dashRows(); setStatus('offline', 'No data yet'); }
    else setStatus('retry', 'Showing the last good data');
    schedule(wait);
  } finally { state.busy = false; }
}

export function initMarket() {
  skeletonRows();
  document.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    state.sort = b.dataset.sort;
    document.querySelectorAll('[data-sort]').forEach((o) => o.setAttribute('aria-selected', String(o === b)));
    if (state.hasData) render(false);
  }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(state.timer); else { clearTimeout(state.timer); tick(); }
  });
  tick();
}
