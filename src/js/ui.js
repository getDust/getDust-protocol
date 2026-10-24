const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let toastTimer = 0;
export function toast(msg) {
  const t = $('[data-toast]');
  if (!t) return;
  t.textContent = msg; t.setAttribute('data-show', '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.removeAttribute('data-show'), 1600);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); return ok;
  }
}

// delegated: any [data-copy] button copies its value and shows feedback
export function initCopy() {
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const ok = await copyText(b.dataset.copy);
    toast(ok ? 'Copied to clipboard' : 'Copy failed, select it by hand');
    if (!ok) return;
    b.setAttribute('data-done', '');
    const lab = $('[data-copy-label]', b); const prev = lab && lab.textContent;
    if (lab) lab.textContent = 'Copied';
    setTimeout(() => { b.removeAttribute('data-done'); if (lab) lab.textContent = prev; }, 1500);
  });
}

export function initNav() {
  const btn = $('[data-menu]'); const dr = $('#drawer');
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open)); btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    dr.hidden = !open;
  });
  $$('a', dr).forEach((a) => a.addEventListener('click', () => { btn.setAttribute('aria-expanded', 'false'); dr.hidden = true; }));
  const links = $$('.nav__links a');
  const secs = links.map((a) => $(a.getAttribute('href')));
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) links.forEach((a, i) => a.setAttribute('aria-current', String(secs[i] === e.target))); }), { rootMargin: '-40% 0px -55% 0px' });
  secs.forEach((s) => s && io.observe(s));
}

// strike handle on the sketch chart: pointer drag and arrow keys, purely visual
export function initTicket() {
  const wrap = $('.ticket__chart'); const h = $('[data-handle]'); if (!wrap || !h) return;
  const line = $('[data-strike-line]'); const clip = $('[data-clip]');
  let v = 50;
  const set = (n) => {
    v = Math.max(4, Math.min(96, n));
    const frac = v / 100;
    h.style.top = `${24 + (wrap.clientHeight - 80) * frac}px`;
    const y = 300 * frac; line.setAttribute('y1', y); line.setAttribute('y2', y); clip.setAttribute('height', y);
    h.setAttribute('aria-valuenow', String(Math.round(100 - v)));
  };
  const fromEvent = (e) => { const r = wrap.getBoundingClientRect(); set(((e.clientY - r.top - 24) / (r.height - 80)) * 100); };
  h.addEventListener('pointerdown', (e) => { h.setPointerCapture(e.pointerId); h.setAttribute('data-active', ''); fromEvent(e); });
  h.addEventListener('pointermove', (e) => { if (h.hasPointerCapture(e.pointerId)) fromEvent(e); });
  h.addEventListener('pointerup', (e) => { h.releasePointerCapture(e.pointerId); h.removeAttribute('data-active'); });
  h.addEventListener('keydown', (e) => {
    const k = { ArrowUp: -4, ArrowDown: 4, ArrowLeft: -4, ArrowRight: 4, PageUp: -12, PageDown: 12 }[e.key];
    if (k === undefined) return; e.preventDefault(); set(v + k);
  });
  addEventListener('resize', () => set(v));
  set(v);

  const wins = $$('[data-win]');
  wins.forEach((b) => b.addEventListener('click', () => wins.forEach((o) => o.setAttribute('aria-checked', String(o === b)))));
  $('.windows').addEventListener('keydown', (e) => {
    const cur = wins.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
    const n = wins[(cur + d + wins.length) % wins.length]; n.click(); n.focus();
  });
}

// mechanics: the active step follows scroll position; a click also selects
export function initSteps() {
  const steps = $$('[data-step]');
  const on = (s) => steps.forEach((o) => (o === s ? o.setAttribute('data-on', '') : o.removeAttribute('data-on')));
  steps.forEach((s) => s.addEventListener('click', () => on(s)));
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) on(e.target); }), { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => io.observe(s));
}
