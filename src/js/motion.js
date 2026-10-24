import { spring, reduced } from './spring.js';

const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// scroll reveal: spring-driven rise and fade, staggered within each intersection batch
export function initReveal() {
  const items = $$('[data-reveal]');
  if (reduced() || !('IntersectionObserver' in window)) { items.forEach((el) => { el.style.opacity = '1'; }); return; }
  const place = (el, p) => { el.style.opacity = String(Math.min(1, Math.max(0, p))); el.style.transform = `translate3d(0, ${(1 - p) * 32}px, 0)`; };
  items.forEach((el) => place(el, 0));
  const io = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((e, i) => {
      io.unobserve(e.target);
      const el = e.target;
      spring({ from: 0, to: 1, stiffness: 170, damping: 20, delay: i * 70, onUpdate: (p) => place(el, p), onDone: () => { el.style.transform = ''; el.style.opacity = '1'; } });
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  items.forEach((el) => io.observe(el));
}

// scroll progress bar and sticky nav state
export function initProgress() {
  const bar = document.querySelector('[data-progress]');
  const nav = document.querySelector('[data-nav]');
  let ticking = false;
  const update = () => {
    ticking = false;
    const h = document.documentElement.scrollHeight - innerHeight;
    const p = h > 0 ? scrollY / h : 0;
    bar.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
    if (scrollY > 8) nav.setAttribute('data-stuck', ''); else nav.removeAttribute('data-stuck');
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

// hero parallax: pointer and scroll feed one eased target per depth layer
export function initParallax() {
  if (reduced()) return;
  const hero = document.querySelector('[data-hero]');
  const layers = $$('[data-depth]', hero).map((el) => ({ el, d: parseFloat(el.dataset.depth), x: 0, y: 0 }));
  let px = 0, py = 0, sy = 0, raf = 0;
  const loop = () => {
    for (const l of layers) {
      const tx = px * 26 * l.d, ty = py * 20 * l.d + sy * 60 * l.d;
      l.x += (tx - l.x) * 0.08; l.y += (ty - l.y) * 0.08;
      l.el.style.transform = `translate3d(${l.x.toFixed(2)}px, ${l.y.toFixed(2)}px, 0)`;
    }
    raf = requestAnimationFrame(loop);
  };
  hero.addEventListener('pointermove', (e) => { const r = hero.getBoundingClientRect(); px = (e.clientX - r.left) / r.width - 0.5; py = (e.clientY - r.top) / r.height - 0.5; });
  hero.addEventListener('pointerleave', () => { px = 0; py = 0; });
  addEventListener('scroll', () => { const r = hero.getBoundingClientRect(); sy = Math.max(-1, Math.min(1, -r.top / Math.max(1, r.height))); }, { passive: true });
  const io = new IntersectionObserver(([e]) => { cancelAnimationFrame(raf); if (e.isIntersecting) raf = requestAnimationFrame(loop); });
  io.observe(hero);
}

// spotlight: one delegated listener writes the pointer position onto the hovered surface
export function initSpot() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('[data-spot], .row');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

// count-up with a flash on change; tweens the visible number toward the new value
export function countTo(el, to, fmt) {
  const from = el._v ?? 0;
  if (from === to && el.dataset.set) return;
  el._v = to;
  if (from !== 0 && from !== to) {
    const host = el.closest('.row, .stat') || el;
    host.classList.remove('flash-up', 'flash-down'); void host.offsetWidth;
    host.classList.add(to >= from ? 'flash-up' : 'flash-down');
  }
  el.dataset.set = '1';
  spring({ from, to, stiffness: 120, damping: 20, onUpdate: (v) => { el.textContent = fmt(v); }, onDone: () => { el.textContent = fmt(to); } });
}
