// Damped harmonic oscillator, integrated in fixed 1/240s steps (semi-implicit Euler).
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function spring({ from = 0, to = 1, stiffness = 170, damping = 22, mass = 1, onUpdate, onDone, delay = 0 }) {
  if (reduced()) { onUpdate(to); if (onDone) onDone(); return () => {}; }
  let x = from, v = 0, last = 0, raf = 0, dead = false, acc = 0;
  const t0 = performance.now() + delay;
  const dt = 1 / 240;
  const tick = (now) => {
    if (dead) return;
    if (now < t0) { raf = requestAnimationFrame(tick); return; }
    if (!last) last = now;
    acc += Math.min(0.05, (now - last) / 1000); last = now;
    while (acc >= dt) {
      const a = (-stiffness * (x - to) - damping * v) / mass;
      v += a * dt; x += v * dt; acc -= dt;
    }
    onUpdate(x);
    if (Math.abs(x - to) < 0.0005 && Math.abs(v) < 0.001) { onUpdate(to); if (onDone) onDone(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { dead = true; cancelAnimationFrame(raf); };
}
