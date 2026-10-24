// Gates. node tools/gates.mjs  -> exit 0 only if every gate passes on both CA branches
// and every mutation is caught. Mutations read the live register at runtime; none anchors
// on a fixed state string.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src');
const read = (f) => fs.readFileSync(f, 'utf8');
const clone = (o) => JSON.parse(JSON.stringify(o));
const TEST_ADDR = 'So11111111111111111111111111111111111111112'; // public fixture, used only in temp builds
const FOREIGN_ADDR = 'Vote111111111111111111111111111111111111111';

// ------------------------------------------------------------------ helpers
function walk(dir, skip = []) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, skip)); else out.push(p);
  }
  return out;
}
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&mdash;': '—', '&nbsp;': ' ' };
const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (m) => ENT[m] ?? ' ');
const stripBlocks = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
const textNodes = (h) => stripBlocks(h).split(/<[^>]*>/).map(decode).map((t) => t.trim()).filter(Boolean);
const attrTexts = (h) => [...h.matchAll(/\b(?:aria-label|title|alt|content|placeholder|aria-valuetext)="([^"]*)"/g)].map((m) => decode(m[1]));
const stated = (r) => r && r.state === 'stated';
const statedStrings = (reg) => new Set(Object.values(reg.records).filter(stated).flatMap((r) => Object.values(r).filter((v) => typeof v === 'string')));
const exemptCa = (h) => h.replace(/<div class="ca[^"]*" data-ca[\s\S]*?<\/div>/g, ' ');

function build(register, out, src = SRC) {
  const tmp = path.join(os.tmpdir(), `dust-reg-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(register));
  execFileSync(process.execPath, [path.join(root, 'tools/build.mjs'), '--register', tmp, '--out', out, '--src', src], { stdio: 'pipe' });
  fs.rmSync(tmp, { force: true });
}
const tmpDir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `dust-${tag}-`));

// ------------------------------------------------------------------ gates
// each gate: (ctx) => string[] of problems; ctx = { root, srcDir, distDir, register }
const GATES = [];
const gate = (id, name, fn) => GATES.push({ id, name, fn });

gate('G01', 'dist holds every shipped file', ({ distDir }) => {
  const need = ['index.html', 'favicon.svg', 'register.json', 'css/tokens.css', 'css/styles.css', 'assets/dust-logo.png', 'js/main.js', 'js/market.js', 'js/motion.js', 'js/spring.js', 'js/ui.js'];
  return need.filter((f) => !fs.existsSync(path.join(distDir, f))).map((f) => `missing dist/${f}`);
});

gate('G02', 'logo is copied into dist and index.html reaches it by a correct relative path', ({ distDir, srcDir }) => {
  const p = [];
  const html = read(path.join(distDir, 'index.html'));
  const srcs = [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  if (!srcs.some((s) => s === 'assets/dust-logo.png')) p.push('no <img> points at assets/dust-logo.png');
  for (const s of srcs) {
    if (/^(https?:|\/|data:)/.test(s)) p.push(`img src not relative: ${s}`);
    else if (!fs.existsSync(path.join(distDir, s))) p.push(`img src does not resolve in dist: ${s}`);
  }
  const f = path.join(distDir, 'assets/dust-logo.png');
  if (fs.existsSync(f)) {
    const b = fs.readFileSync(f);
    if (b.subarray(1, 4).toString() !== 'PNG') p.push('logo is not a PNG');
    if (Buffer.compare(b, fs.readFileSync(path.join(srcDir, 'assets/dust-logo.png'))) !== 0) p.push('dist logo differs from src logo');
    if (b.length < 5000) p.push('logo suspiciously small');
  }
  return p;
});

gate('G03', 'favicon is a 32x32 SVG with no comments and no double hyphens', ({ distDir }) => {
  const f = path.join(distDir, 'favicon.svg'); if (!fs.existsSync(f)) return ['favicon.svg missing'];
  const s = read(f); const p = [];
  if (!/viewBox="0 0 32 32"/.test(s) || !/width="32"/.test(s) || !/height="32"/.test(s)) p.push('not 32x32');
  if (s.includes('<!--') || s.includes('-->')) p.push('contains an XML comment');
  if (s.includes('--')) p.push('contains a double hyphen');
  if (!/^<svg[\s>]/.test(s.trim()) || !s.trim().endsWith('</svg>')) p.push('not a bare svg document');
  const tags = [...s.matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]);
  if (!tags.includes('path')) p.push('no traced paths');
  return p;
});

gate('G04', 'palette: colour literals live only in tokens.css, and each is declared', ({ srcDir, distDir }) => {
  const p = []; const HEX = /#[0-9a-fA-F]{3,8}\b/g; const FUNC = /\b(?:rgba?|hsla?)\(/g;
  const tokens = read(path.join(srcDir, 'tokens.css'));
  const declared = new Set((tokens.replace(/\/\*[\s\S]*?\*\//g, '').match(HEX) || []).map((h) => h.toLowerCase()));
  if (declared.size > 6) p.push(`tokens.css declares ${declared.size} literals`);
  for (const f of walk(srcDir)) {
    if (!/\.(css|js|html)$/.test(f) || path.basename(f) === 'tokens.css') continue;
    const s = read(f);
    for (const m of s.match(HEX) || []) p.push(`hex ${m} outside tokens.css in ${path.relative(srcDir, f)}`);
    for (const m of s.match(FUNC) || []) p.push(`${m} outside tokens.css in ${path.relative(srcDir, f)}`);
  }
  const cs = path.join(distDir, 'css/styles.css');
  if (fs.existsSync(cs)) for (const m of read(cs).match(HEX) || []) p.push(`hex ${m} in dist styles`);
  const dh = path.join(distDir, 'index.html');
  if (fs.existsSync(dh)) for (const m of read(dh).match(HEX) || []) if (!declared.has(m.toLowerCase())) p.push(`hex ${m} in dist html is not a token`);
  const fv = path.join(distDir, 'favicon.svg');
  if (fs.existsSync(fv)) for (const m of read(fv).match(HEX) || []) if (!declared.has(m.toLowerCase())) p.push(`favicon colour ${m} is not a token`);
  if (!/k-means/i.test(tokens) || !/\(\d+,\d+\)/.test(tokens)) p.push('tokens.css lacks provenance comment');
  return p;
});

gate('G05', 'register: every record has a state; inert records carry no value or url', ({ register }) => {
  const p = []; const VALUE_KEYS = ['value', 'url', 'rpc', 'boosts', 'pairs'];
  for (const [k, r] of Object.entries(register.records)) {
    if (!['stated', 'absent', 'unconfirmed'].includes(r.state)) p.push(`${k}: bad state ${r.state}`);
    if (r.state !== 'stated') for (const key of VALUE_KEYS) if (key in r) p.push(`${k}: inert record carries ${key}`);
    if (r.state === 'stated' && !VALUE_KEYS.some((key) => typeof r[key] === 'string' && r[key])) p.push(`${k}: stated record has no value or url`);
  }
  return p;
});

gate('G06', 'link rule: hrefs come only from stated records; handles are derived', ({ distDir, register }) => {
  const p = []; const html = read(path.join(distDir, 'index.html'));
  const urls = new Set(Object.values(register.records).filter(stated).map((r) => r.url).filter(Boolean));
  for (const m of html.matchAll(/<a\b[^>]*\shref="(https?:[^"]+)"/g)) if (!urls.has(m[1])) p.push(`external href not in a stated record: ${m[1]}`);
  for (const [k, r] of Object.entries(register.records)) {
    const el = html.match(new RegExp(`<(a|span)\\b[^>]*data-social="${k}"[^>]*>`));
    if (!el) continue;
    if (stated(r) && r.url) {
      if (el[1] !== 'a' || !el[0].includes(`href="${r.url}"`)) p.push(`${k}: stated record not linked verbatim`);
      const handle = new URL(r.url).pathname.split('/').filter(Boolean)[0];
      if (handle && !el[0].includes(`@${handle}`)) p.push(`${k}: handle not derived from url`);
    } else {
      if (el[1] === 'a' || /\shref=/.test(el[0])) p.push(`${k}: unstated record has an href`);
      if (!/aria-disabled="true"/.test(el[0])) p.push(`${k}: inert icon not marked aria-disabled`);
    }
  }
  for (const m of html.matchAll(/<li[^>]*data-record="([^"]+)"[^>]*data-state="([^"]+)"[\s\S]*?<\/li>/g)) if (m[2] !== 'stated' && /href=/.test(m[0])) p.push(`record ${m[1]} is inert but links out`);
  return p;
});

gate('G07', 'address scan: address-shaped strings must match a stated record, 0x included, CA slot exempt', ({ distDir, register }) => {
  const p = []; const ok = statedStrings(register);
  const B58 = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g; const ETH = /\b0x[0-9a-fA-F]{40}\b/g;
  const files = [...walk(distDir)].filter((f) => /\.(html|js|css|json|svg)$/.test(f));
  for (const f of files) {
    const s = f.endsWith('.html') ? exemptCa(read(f)) : read(f);
    const rel = path.relative(distDir, f);
    for (const m of s.match(B58) || []) if (/\d/.test(m) && /[a-zA-Z]/.test(m) && !ok.has(m)) p.push(`${rel}: unregistered address-shaped string ${m.slice(0, 12)}...`);
    for (const m of s.match(ETH) || []) if (!ok.has(m)) p.push(`${rel}: unregistered 0x address ${m.slice(0, 12)}...`);
  }
  const ca = register.records.ca; const html = read(path.join(distDir, 'index.html'));
  for (const m of html.matchAll(/<div class="ca[^"]*" data-ca[\s\S]*?<\/div>/g)) if (stated(ca) && !m[0].includes(ca.value)) p.push('CA slot does not carry the registered value');
  return p;
});

gate('G08', 'CA slot: inert without a stated CA, live and copyable with one', ({ distDir, register }) => {
  const p = []; const html = read(path.join(distDir, 'index.html')); const ca = register.records.ca;
  const slots = [...html.matchAll(/<div class="ca[^"]*" data-ca[\s\S]*?<\/div>/g)].map((m) => m[0]);
  if (slots.length < 2) p.push(`expected CA slot in header and footer, found ${slots.length}`);
  for (const s of slots) {
    if (stated(ca)) {
      if (!/data-state="stated"/.test(s)) p.push('stated CA slot not marked stated');
      if (!s.includes(`data-copy="${ca.value}"`)) p.push('stated CA slot lacks click-to-copy with full address');
      if (!/<button/.test(s) || !s.includes(`<code class="ca__addr">${ca.value}</code>`)) p.push('stated CA slot lacks full address in a button');
    } else {
      if (/data-copy|<button|<a\b|href=/.test(s)) p.push('inert CA slot is interactive');
      if (/data-state="stated"/.test(s)) p.push('inert CA slot marked stated');
      if (!/pending/.test(s)) p.push('inert CA slot lacks the pending label');
      if (/[1-9A-HJ-NP-Za-km-z]{32,44}/.test(s.replace(/<[^>]+>/g, ' ').replace(/Contract address/, ''))) p.push('inert CA slot carries an address');
    }
  }
  const css = read(path.join(distDir, 'css/styles.css'));
  if (!/\.ca__addr\s*\{[^}]*font:\s*600 clamp\(15px/.test(css)) p.push('CA font is not large');
  if (!/\.nav\s*\{[^}]*position:\s*sticky/.test(css)) p.push('CA slot is not in a sticky header');
  return p;
});

gate('G09', 'social: icon-only X and GitHub, both rendered at every breakpoint', ({ distDir }) => {
  const p = []; const html = read(path.join(distDir, 'index.html')); const css = read(path.join(distDir, 'css/styles.css'));
  const right = (html.match(/<div class="nav__right">([\s\S]*?)<button class="icon-btn nav__menu"/) || [])[1] || '';
  for (const k of ['x', 'github']) {
    const m = right.match(new RegExp(`<(a|span)\\b[^>]*data-social="${k}"[^>]*>([\\s\\S]*?)</\\1>`));
    if (!m) { p.push(`${k} icon missing from the top right`); continue; }
    if (!/<svg[\s\S]*<path/.test(m[2])) p.push(`${k} has no svg mark`);
    if (m[2].replace(/<svg[\s\S]*?<\/svg>/g, '').trim()) p.push(`${k} carries a text label`);
  }
  if (!/M18\.244 2\.25h3\.308/.test(right)) p.push('X mark is not the official path');
  if (!/M8 0c4\.42 0 8 3\.58 8 8/.test(right)) p.push('GitHub mark is not the official Octicon path');
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (/icon-btn|data-social|nav__right/.test(m[1]) && !/nav__menu/.test(m[1]) && /display:\s*none|visibility:\s*hidden/.test(m[2])) p.push(`CSS hides social icons: ${m[1].trim()}`);
  if (!/\.nav__right\s*\{[^}]*margin-left:\s*auto/.test(css)) p.push('social cluster is not pinned right');
  return p;
});

gate('G10', 'no dates, times or recency words anywhere visible, in attributes, scripts or shipped data', ({ distDir }) => {
  const p = []; const html = read(path.join(distDir, 'index.html'));
  const vis = [...textNodes(html), ...attrTexts(html)].join(' | ');
  const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
  const rules = [[/\b\d{4}-\d{2}-\d{2}\b/, 'iso date'], [/\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/, 'numeric date'], [/\b(?:19|20)\d{2}\b/, 'year'], [new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}\\b`, 'i'), 'month day'], [new RegExp(`\\b\\d{1,2}\\s+${MONTH}\\b`, 'i'), 'day month'], [/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm|utc|gmt)?\b/i, 'clock'], [/\b(?:as of|checked|last updated|updated|timestamp|verified on|synced at|today|yesterday|tomorrow)\b/i, 'recency word']];
  for (const [re, label] of rules) { const m = vis.match(re); if (m) p.push(`html ${label}: "${m[0]}"`); }
  const BAN = /toLocaleDateString|toLocaleTimeString|toLocaleString|toISOString|toDateString|toUTCString|toTimeString|new Date|Date\.parse|Date\.now|DateTimeFormat|getFullYear|RelativeTimeFormat/;
  for (const f of walk(path.join(distDir, 'js'))) { const m = read(f).match(BAN); if (m) p.push(`${path.relative(distDir, f)} uses ${m[0]}`); }
  for (const m of read(path.join(distDir, 'css/styles.css')).matchAll(/content:\s*"([^"]+)"/g)) if (/\d/.test(m[1])) p.push(`css content string "${m[1]}"`);
  const reg = read(path.join(distDir, 'register.json'));
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(reg) || /"recorded"/.test(reg)) p.push('shipped register.json carries dates');
  return p;
});

gate('G11', 'reduced motion: CSS zeroes every animation and transition, JS springs resolve instantly', ({ distDir }) => {
  const p = []; const css = read(path.join(distDir, 'css/styles.css'));
  const block = (css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/) || [])[1];
  if (!block) return ['no prefers-reduced-motion block'];
  if (!/animation:\s*none\s*!important/.test(block) || !/transition:\s*none\s*!important/.test(block)) p.push('reduced block does not zero animation and transition');
  if (!/\[data-reveal\][^}]*opacity:\s*1/.test(block)) p.push('reduced block does not reveal content');
  const sp = read(path.join(distDir, 'js/spring.js'));
  if (!/prefers-reduced-motion: reduce/.test(sp) || !/if \(reduced\(\)\) \{ onUpdate\(to\)/.test(sp)) p.push('spring does not short-circuit under reduced motion');
  const mo = read(path.join(distDir, 'js/motion.js'));
  if (!/reduced\(\)/.test(mo)) p.push('motion.js ignores reduced motion');
  const loops = [...css.matchAll(/animation:[^;}]*infinite/g)].length;
  if (loops < 3) p.push('expected the ambient animations to be present');
  return p;
});

gate('G12', 'no ch units anywhere', ({ distDir }) => {
  const p = [];
  for (const f of walk(distDir).filter((x) => /\.(css|html|js)$/.test(x))) { const m = read(f).match(/(?<![\w-])\d*\.?\d+ch\b/); if (m) p.push(`${path.relative(distDir, f)}: ${m[0]}`); }
  return p;
});

gate('G13', 'repo hygiene: no agent config, no tool attribution', ({ root: r }) => {
  const p = [];
  const bad = ['CLAUDE.md', '.claude', 'AGENTS.md', '.cursorrules'];
  for (const b of bad) if (fs.existsSync(path.join(r, b))) p.push(`${b} present`);
  const pat = new RegExp(['clau' + 'de', 'anthr' + 'opic', 'chat' + 'gpt', 'open' + 'ai', 'generated (?:by|with)', 'co-authored', 'copi' + 'lot', '\\bA\\.?I[- ](?:powered|generated|assisted)'].join('|'), 'i');
  const skip = ['node_modules', 'brand', 'reference', '.git'];
  for (const f of walk(r, skip)) {
    if (!/\.(md|json|html|css|js|mjs|svg|txt|py)$|LICENSE$/.test(f)) continue;
    if (path.basename(f) === 'gates.mjs' || path.basename(f) === 'ref-corpus.txt') continue;
    const m = read(f).match(pat); if (m) p.push(`${path.relative(r, f)} mentions "${m[0]}"`);
  }
  for (const need of ['README.md', 'LICENSE', 'docs/whitepaper.md']) if (!fs.existsSync(path.join(r, need))) p.push(`${need} missing`);
  if (fs.existsSync(path.join(r, 'dist'))) for (const f of ['README.md', 'LICENSE', 'whitepaper.md', 'docs']) if (fs.existsSync(path.join(r, 'dist', f))) p.push(`dist/${f} must not exist`);
  const lic = path.join(r, 'LICENSE'); if (fs.existsSync(lic) && !/MIT License/.test(read(lic)) || (fs.existsSync(lic) && !/Copyright \(c\) 2026 Dust/.test(read(lic)))) p.push('LICENSE is not MIT / Dust / 2026');
  return p;
});

gate('G14', 'market: live, polled, backed off, paused when hidden, and blind to every other record', ({ distDir, register }) => {
  const p = []; const m = read(path.join(distDir, 'js/market.js')); const html = read(path.join(distDir, 'index.html'));
  if (/data-ca|records\.ca|\.ca\b|register|"ca"|'ca'/.test(m.replace(/\bca\b(?=lc)/g, ''))) p.push('market.js touches the CA record');
  if (!/POLL_MS = 60000/.test(m)) p.push('poll is not 60s');
  if (!/BACKOFF_BASE \* 2 \*\* /.test(m)) p.push('no exponential backoff');
  if (!/visibilitychange/.test(m) || !/document\.hidden/.test(m)) p.push('no visibility pause');
  if (!/TOP_N = 10/.test(m) || !/sort\(\(a, b\) => b\.volume - a\.volume\)/.test(m)) p.push('not top ten by 24h volume');
  if (!/chainId === 'solana'/.test(m)) p.push('no solana filter');
  if (!/imageUrl/.test(m) || !/onerror/.test(m)) p.push('no logo with letter fallback');
  if (!/skel/.test(m)) p.push('no skeleton loaders');
  if (!/data-copy="\$\{esc\(r\.address\)\}"/.test(m)) p.push('no per-row copy-address button');
  if (!/lastGood|hasData/.test(m)) p.push('no last-good retention');
  const src = (html.match(/id="market-source">([\s\S]*?)<\/script>/) || [])[1];
  const mk = register.records.market;
  if (!stated(mk)) p.push('market record is not stated');
  else { try { const j = JSON.parse(src); if (j.boosts !== mk.boosts || j.pairs !== mk.pairs) p.push('inline market source differs from the register'); } catch { p.push('inline market source unreadable'); } }
  const allowed = new Set([mk.boosts, mk.pairs].filter(Boolean));
  for (const f of walk(path.join(distDir, 'js'))) for (const u of read(f).match(/https?:\/\/[^\s'"`)]+/g) || []) if (![...allowed].some((a) => a.startsWith(u) || u.startsWith(a.split('{')[0]))) p.push(`${path.basename(f)} reaches an unregistered host: ${u}`);
  return p;
});

gate('G15', 'copy: zero shared two-word runs with the reference corpus', ({ distDir, root: r }) => {
  const html = read(path.join(distDir, 'index.html'));
  const words = (t) => (t.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) || []);
  const grams = (t) => { const w = words(t); const o = []; for (let i = 0; i + 1 < w.length; i++) o.push(`${w[i]} ${w[i + 1]}`); return o; };
  const ref = new Set(read(path.join(r, 'tools/ref-corpus.txt')).split('\n').flatMap(grams));
  const hits = new Set();
  for (const t of [...textNodes(html), ...attrTexts(html)]) for (const g of grams(t)) if (ref.has(g)) hits.add(g);
  for (const f of walk(path.join(distDir, 'js'))) for (const m of read(f).matchAll(/'([A-Z][^'\n]{6,})'/g)) for (const g of grams(m[1])) if (ref.has(g)) hits.add(g);
  return [...hits].map((g) => `shared bigram "${g}"`);
});

gate('G16', 'tap targets: every control is sized from a 44px token', ({ distDir }) => {
  const p = []; const css = read(path.join(distDir, 'css/styles.css')); const tok = read(path.join(distDir, 'css/tokens.css'));
  if (!/--tap:\s*44px/.test(tok)) p.push('--tap is not 44px');
  for (const sel of ['.icon-btn', '.btn', '.copy', '.windows button', '.ca__copy']) {
    const re = new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{[^}]*(?:min-height|height|width):\\s*var\\(--tap\\)`);
    if (!re.test(css) && !(sel === '.windows button' && /\.windows button, \.tabs button\s*\{[^}]*min-height:\s*var\(--tap\)/.test(css))) p.push(`${sel} not sized by --tap`);
  }
  return p;
});

gate('G17', 'a11y basics: alt on images, lang, labelled controls, no inert link targets', ({ distDir }) => {
  const p = []; const html = read(path.join(distDir, 'index.html'));
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\salt=/.test(m[0])) p.push('img without alt');
  if (!/<html lang="en"/.test(html)) p.push('no lang');
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) if (!/aria-label=/.test(m[1]) && !m[2].replace(/<[^>]+>/g, '').trim()) p.push('unlabelled button');
  if (/href="#"/.test(html)) p.push('placeholder href="#"');
  return p;
});

// ------------------------------------------------------------------ runner
function runAll(ctx) { return GATES.map((g) => { let problems; try { problems = g.fn(ctx); } catch (e) { problems = [`threw: ${e.message}`]; } return { id: g.id, name: g.name, ok: problems.length === 0, problems }; }); }

const results = []; let failed = 0;
const line = (ok, s) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`);
function report(label, rs) {
  console.log(`\n== ${label}`);
  for (const r of rs) { line(r.ok, `${r.id} ${r.name}`); if (!r.ok) { failed++; r.problems.slice(0, 60).forEach((x) => console.log(`        ${x}`)); } results.push(r); }
}

const baseReg = JSON.parse(read(path.join(SRC, 'register.json')));

// branch A: the register as committed (read at runtime); branch B: the opposite CA state
const withCa = (reg, on) => { const r = clone(reg); if (on) { r.records.ca = { label: r.records.ca.label, state: 'stated', value: TEST_ADDR }; } else { r.records.ca = { label: r.records.ca.label, state: 'absent' }; } return r; };
const branches = [['CA absent', withCa(baseReg, false)], ['CA stated', withCa(baseReg, true)]];
const builtDirs = [];
for (const [label, reg] of branches) {
  const d = tmpDir(label.replace(/\W/g, '')); build(reg, d); builtDirs.push(d);
  report(`branch: ${label}`, runAll({ root, srcDir: SRC, distDir: d, register: reg }));
}
// the shipped dist, whatever the committed register says
report('shipped dist/', runAll({ root, srcDir: SRC, distDir: path.join(root, 'dist'), register: baseReg }));

// market must be byte-identical across CA branches
{
  const sect = (d) => (read(path.join(d, 'index.html')).match(/<section class="band" id="market"[\s\S]*?<\/section>/) || [''])[0];
  const same = sect(builtDirs[0]) === sect(builtDirs[1]) && sect(builtDirs[0]).length > 500 && read(path.join(builtDirs[0], 'js/market.js')) === read(path.join(builtDirs[1], 'js/market.js'))
    && (read(path.join(builtDirs[0], 'index.html')).match(/id="market-source">[\s\S]*?<\/script>/) || [])[0] === (read(path.join(builtDirs[1], 'index.html')).match(/id="market-source">[\s\S]*?<\/script>/) || [])[0];
  const r = { id: 'G18', name: 'market markup, source and code are identical in both CA branches', ok: same, problems: same ? [] : ['market differs between CA absent and CA stated'] };
  line(r.ok, `${r.id} ${r.name}`); if (!r.ok) failed++; results.push(r);
}

// ------------------------------------------------------------------ mutation harness
console.log('\n== mutations (each must be caught by its gate)');
let caught = 0; let total = 0;
function mutation(name, expectId, fn, { expectPass = false } = {}) {
  total++;
  const d = tmpDir('mut'); let outcome;
  try {
    const ctx = fn(d);
    const rs = runAll(ctx);
    const g = rs.find((r) => r.id === expectId);
    outcome = expectPass ? g.ok : !g.ok;
  } catch (e) { outcome = false; console.log('        ' + e.message); }
  if (outcome) caught++; else failed++;
  line(outcome, `${name} -> ${expectId} ${expectPass ? 'stays green' : 'trips'}`);
  fs.rmSync(d, { recursive: true, force: true });
}
const buildMut = (d, reg, after) => { build(reg, d); if (after) after(d); return { root, srcDir: SRC, distDir: d, register: reg }; };
const patch = (d, f, fn) => { const p = path.join(d, f); fs.writeFileSync(p, fn(read(p))); };
// pick records at runtime by state, forcing the needed state first
const pickInert = (reg) => { const r = clone(reg); let k = Object.keys(r.records).find((x) => r.records[x].state !== 'stated' && x !== 'ca'); if (!k) { k = 'github'; r.records[k] = { label: r.records[k].label, state: 'absent' }; } return [r, k]; };
const pickStatedUrl = (reg) => { const r = clone(reg); let k = Object.keys(r.records).find((x) => r.records[x].state === 'stated' && r.records[x].url); if (!k) { k = 'x'; r.records[k] = { label: 'X', state: 'stated', url: 'https://x.com/getDustFun' }; } return [r, k]; };

mutation('inert record gains a value', 'G05', (d) => { const [r, k] = pickInert(baseReg); r.records[k].value = 'x'; return buildMut(d, r); });
mutation('inert record gains a url', 'G05', (d) => { const [r, k] = pickInert(baseReg); r.records[k].url = 'https://example.com'; return buildMut(d, r); });
mutation('stated record loses its url', 'G05', (d) => { const [r, k] = pickStatedUrl(baseReg); delete r.records[k].url; return { root, srcDir: SRC, distDir: (build(withCa(baseReg, false), d), d), register: r }; });
mutation('state value corrupted', 'G05', (d) => { const r = clone(baseReg); r.records[Object.keys(r.records)[0]].state = 'maybe'; return { root, srcDir: SRC, distDir: (build(baseReg, d), d), register: r }; });
mutation('inert icon gains an href', 'G06', (d) => { const [r, k] = pickInert(baseReg); return buildMut(d, r, (x) => patch(x, 'index.html', (h) => h.replace(new RegExp(`<span class="icon-btn is-inert" data-social="${k}"`), `<span class="icon-btn is-inert" href="https://example.com" data-social="${k}"`))); });
mutation('inert icon becomes a link', 'G06', (d) => { const [r, k] = pickInert(baseReg); return buildMut(d, r, (x) => patch(x, 'index.html', (h) => h.replace(new RegExp(`<span class="icon-btn is-inert" data-social="${k}"`), `<a class="icon-btn" href="https://github.com/x" data-social="${k}"`))); });
mutation('stated link points elsewhere', 'G06', (d) => { const [r, k] = pickStatedUrl(baseReg); return buildMut(d, r, (x) => patch(x, 'index.html', (h) => h.replace(r.records[k].url, 'https://x.com/someoneElse'))); });
mutation('foreign address in the page', 'G07', (d) => buildMut(d, withCa(baseReg, false), (x) => patch(x, 'index.html', (h) => h.replace('</main>', `<p>${FOREIGN_ADDR}</p></main>`))));
mutation('foreign 0x address in the page', 'G07', (d) => buildMut(d, withCa(baseReg, false), (x) => patch(x, 'index.html', (h) => h.replace('</main>', `<p>0x${'ab12'.repeat(10)}</p></main>`))));
mutation('address planted while CA is absent (inside CA slot)', 'G08', (d) => buildMut(d, withCa(baseReg, false), (x) => patch(x, 'index.html', (h) => h.replace(/(<span class="ca__addr ca__addr--inert"[^>]*>)pending/, `$1${TEST_ADDR}`))));
mutation('copy handler on an inert CA slot', 'G08', (d) => buildMut(d, withCa(baseReg, false), (x) => patch(x, 'index.html', (h) => h.replace('<div class="ca is-inert" data-ca', `<div data-copy="${TEST_ADDR}" class="ca is-inert" data-ca`))));
mutation('stated CA loses click-to-copy', 'G08', (d) => buildMut(d, withCa(baseReg, true), (x) => patch(x, 'index.html', (h) => h.replaceAll(`data-copy="${TEST_ADDR}"`, 'data-x="1"'))));
mutation('benign short 0x hex is not blanket-rejected', 'G07', (d) => buildMut(d, withCa(baseReg, false), (x) => patch(x, 'index.html', (h) => h.replace('</main>', '<p>0x1f 0xdeadbeef</p></main>'))), { expectPass: true });
mutation('date appears in page text', 'G10', (d) => buildMut(d, baseReg, (x) => patch(x, 'index.html', (h) => h.replace('</main>', '<p>Refreshed 2026-10-24</p></main>'))));
mutation('clock string appears in an aria-label', 'G10', (d) => buildMut(d, baseReg, (x) => patch(x, 'index.html', (h) => h.replace('<main id="main">', '<main id="main" aria-label="Opened 09:41">'))));
mutation('recency word appears', 'G10', (d) => buildMut(d, baseReg, (x) => patch(x, 'index.html', (h) => h.replace('</main>', '<p>Last updated just now</p></main>'))));
mutation('script formats a date', 'G10', (d) => buildMut(d, baseReg, (x) => patch(x, 'js/market.js', (s) => s + '\nexport const stamp = () => new Date().toLocaleTimeString();\n')));
mutation('shipped register keeps dates', 'G10', (d) => buildMut(d, baseReg, (x) => patch(x, 'register.json', () => JSON.stringify({ a: { recorded: '2026-10-24' } }))));
mutation('stray hex in styles', 'G04', (d) => { const s = tmpDir('src'); fs.cpSync(SRC, s, { recursive: true }); fs.appendFileSync(path.join(s, 'styles.css'), '\n.z{color:#123456}\n'); build(baseReg, d, s); return { root, srcDir: s, distDir: d, register: baseReg }; });
mutation('rgba literal in a script', 'G04', (d) => { const s = tmpDir('src'); fs.cpSync(SRC, s, { recursive: true }); fs.appendFileSync(path.join(s, 'js/ui.js'), "\nexport const c = 'rgba(1,2,3,0.5)';\n"); build(baseReg, d, s); return { root, srcDir: s, distDir: d, register: baseReg }; });
mutation('favicon gains a comment', 'G03', (d) => buildMut(d, baseReg, (x) => patch(x, 'favicon.svg', (s) => s.replace('<rect', '<!-- a -- b --><rect'))));
mutation('favicon is not 32x32', 'G03', (d) => buildMut(d, baseReg, (x) => patch(x, 'favicon.svg', (s) => s.replace('viewBox="0 0 32 32"', 'viewBox="0 0 64 64"'))));
mutation('logo missing from dist', 'G02', (d) => buildMut(d, baseReg, (x) => fs.rmSync(path.join(x, 'assets/dust-logo.png'))));
mutation('logo path points outside dist', 'G02', (d) => buildMut(d, baseReg, (x) => patch(x, 'index.html', (h) => h.replace('src="assets/dust-logo.png"', 'src="/brand/dust-logo.png"'))));
mutation('ch unit in styles', 'G12', (d) => buildMut(d, baseReg, (x) => patch(x, 'css/styles.css', (s) => s + '\n.q{width:60ch}\n')));
mutation('social icons hidden by CSS', 'G09', (d) => buildMut(d, baseReg, (x) => patch(x, 'css/styles.css', (s) => s + '\n@media (max-width:400px){.nav__right .icon-btn{display:none}}\n')));
mutation('social icon gains a text label', 'G09', (d) => buildMut(d, baseReg, (x) => patch(x, 'index.html', (h) => h.replace(/(data-social="x"[^>]*>)/, '$1X on Twitter '))));
mutation('reference phrase pasted in', 'G15', (d) => buildMut(d, baseReg, (x) => patch(x, 'index.html', (h) => h.replace('</main>', '<p>a covered-call market</p></main>'))));
mutation('market reads the CA record', 'G14', (d) => buildMut(d, baseReg, (x) => patch(x, 'js/market.js', (s) => s + "\nconst gate = document.querySelector('[data-ca]');\n")));
mutation('market polls too fast', 'G14', (d) => buildMut(d, baseReg, (x) => patch(x, 'js/market.js', (s) => s.replace('POLL_MS = 60000', 'POLL_MS = 5000'))));
mutation('market reaches a foreign host', 'G14', (d) => buildMut(d, baseReg, (x) => patch(x, 'js/market.js', (s) => s + "\nfetch('https://example.org/data');\n")));
mutation('reduced-motion block removed', 'G11', (d) => buildMut(d, baseReg, (x) => patch(x, 'css/styles.css', (s) => s.replace('@media (prefers-reduced-motion: reduce)', '@media (min-width: 1px)'))));
mutation('tap size token shrinks', 'G16', (d) => buildMut(d, baseReg, (x) => patch(x, 'css/tokens.css', (s) => s.replace('--tap: 44px', '--tap: 30px'))));
mutation('agent config file appears', 'G13', (d) => { const r = tmpDir('root'); fs.cpSync(path.join(root, 'README.md'), path.join(r, 'README.md')); fs.cpSync(path.join(root, 'LICENSE'), path.join(r, 'LICENSE')); fs.mkdirSync(path.join(r, 'docs')); fs.cpSync(path.join(root, 'docs/whitepaper.md'), path.join(r, 'docs/whitepaper.md')); fs.writeFileSync(path.join(r, 'CLAUDE.md'), 'x'); build(baseReg, d); return { root: r, srcDir: SRC, distDir: d, register: baseReg }; });
mutation('attribution line appears', 'G13', (d) => { const r = tmpDir('root'); fs.cpSync(path.join(root, 'LICENSE'), path.join(r, 'LICENSE')); fs.mkdirSync(path.join(r, 'docs')); fs.cpSync(path.join(root, 'docs/whitepaper.md'), path.join(r, 'docs/whitepaper.md')); fs.writeFileSync(path.join(r, 'README.md'), 'Generated by a tool'); build(baseReg, d); return { root: r, srcDir: SRC, distDir: d, register: baseReg }; });
mutation('image without alt', 'G17', (d) => buildMut(d, baseReg, (x) => patch(x, 'index.html', (h) => h.replace('alt=""', ''))));

console.log(`\nmutations caught: ${caught}/${total}`);
const gateIds = new Set(results.map((r) => r.id));
const gatePasses = results.filter((r) => r.ok).length;
console.log(`gates: ${gateIds.size} distinct, ${results.length} runs (${gatePasses} passed, ${results.length - gatePasses} failed)`);
for (const d of builtDirs) fs.rmSync(d, { recursive: true, force: true });
console.log(failed === 0 ? '\nALL GATES GREEN' : `\n${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
