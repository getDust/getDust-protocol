// Static build: src/ -> dist/. Usage: node tools/build.mjs [--register path] [--out dir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const src = path.resolve(arg('--src', path.join(root, 'src')));
const registerPath = path.resolve(arg('--register', path.join(src, 'register.json')));
const out = path.resolve(arg('--out', path.join(root, 'dist')));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const register = JSON.parse(fs.readFileSync(registerPath, 'utf8'));
const rec = register.records;
const stated = (r) => r && r.state === 'stated';

// ---- derive, never duplicate: handle comes from the stored URL
const handleOf = (url) => { try { return new URL(url).pathname.split('/').filter(Boolean)[0] || ''; } catch { return ''; } };

const ICON_X = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
const ICON_GH = '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';

function socialLink(key, icon) {
  const r = rec[key];
  if (stated(r) && r.url) {
    const h = handleOf(r.url);
    return `<a class="icon-btn" data-social="${key}" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(r.label)}, @${esc(h)}">${icon}</a>`;
  }
  return `<span class="icon-btn is-inert" data-social="${key}" role="img" aria-disabled="true" aria-label="${esc(r.label)}, pending" title="${esc(r.label)}: pending">${icon}</span>`;
}

function caSlot(where) {
  const r = rec.ca;
  if (stated(r) && r.value) {
    return `<div class="ca" data-ca data-state="stated" data-where="${where}"><span class="ca__label">${esc(r.label)}</span><button class="ca__copy" type="button" data-copy="${esc(r.value)}" aria-label="Copy contract address"><code class="ca__addr">${esc(r.value)}</code><span class="ca__act" data-copy-label>Copy</span></button></div>`;
  }
  return `<div class="ca is-inert" data-ca data-state="${esc(r.state)}" data-where="${where}"><span class="ca__label">${esc(r.label)}</span><span class="ca__addr ca__addr--inert" aria-disabled="true">pending</span></div>`;
}

function records() {
  return Object.entries(rec).map(([key, r]) => {
    let body;
    if (!stated(r)) body = '<span class="chip chip--inert">pending</span>';
    else if (key === 'x') body = `<a class="chip chip--link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">@${esc(handleOf(r.url))}</a>`;
    else if (key === 'chain') body = `<span class="chip">${esc(r.value)}</span><small>${esc(r.source)}, ${esc(r.scope)}</small>`;
    else if (key === 'market') body = `<span class="chip">Open DEX feed</span><small>${esc(r.source)}</small>`;
    else if (key === 'ca') body = '<span class="chip">Stated above</span>';
    else body = '<span class="chip">Stated</span>';
    return `<li class="record card${stated(r) ? '' : ' is-inert'}" data-spot data-reveal data-record="${key}" data-state="${esc(r.state)}"><span class="record__k">${esc(r.label)}</span><span class="record__v">${body}</span></li>`;
  }).join('');
}

const tokens = fs.readFileSync(path.join(src, 'tokens.css'), 'utf8');
const theme = (tokens.match(/--ground:\s*(#[0-9a-fA-F]{6})/) || [])[1] || '';

const market = rec.market;
const marketSource = JSON.stringify(stated(market) ? { boosts: market.boosts, pairs: market.pairs } : {}).replace(/</g, '\u003c');

let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
html = html
  .replace('{{THEME}}', theme)
  .replace('{{SOCIAL}}', socialLink('x', ICON_X) + socialLink('github', ICON_GH))
  .replace('{{CA_TOP}}', caSlot('top'))
  .replace('{{CA_FOOT}}', caSlot('foot'))
  .replace('{{RECORDS}}', records())
  .replace('{{MARKET_SOURCE}}', marketSource);

// ---- emit: dates stay in src/register.json only; the shipped copy drops them
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'css'), { recursive: true });
fs.mkdirSync(path.join(out, 'js'), { recursive: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

fs.writeFileSync(path.join(out, 'index.html'), html);
const copy = (from, to) => fs.copyFileSync(path.join(src, from), path.join(out, to));
copy('tokens.css', 'css/tokens.css');
copy('styles.css', 'css/styles.css');
for (const f of fs.readdirSync(path.join(src, 'js'))) copy(`js/${f}`, `js/${f}`);
// explicit asset list: the logo must be named here to ship
for (const f of ['dust-logo.png']) copy(`assets/${f}`, `assets/${f}`);
copy('assets/favicon.svg', 'favicon.svg');

const shipped = JSON.parse(JSON.stringify(register));
for (const r of Object.values(shipped.records)) delete r.recorded;
fs.writeFileSync(path.join(out, 'register.json'), JSON.stringify(shipped, null, 2));

console.log(`build ok -> ${path.relative(root, out) || '.'} (ca: ${rec.ca.state})`);
