// Easter-egg effects triggered by tool UI events. All are skipped or reduced under reduced motion.
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

type Theme = { accent?: string; accent2?: string; bg?: string; fg?: string; muted?: string };
export const THEMES: Record<string, Theme> = {
  default: { accent: '#ffffff', accent2: '#ffffff', bg: '#000000', fg: '#ffffff', muted: '#a3a3a3' },
  light: { accent: '#000000', accent2: '#000000', bg: '#ffffff', fg: '#000000', muted: '#5c5c5c' },
};
const KEY = 'wholden-theme';

export function setTheme(t: Theme & { name?: string }) {
  const named = t.name ? THEMES[t.name] : undefined;
  const v = { ...named, ...Object.fromEntries(Object.entries(t).filter(([k, x]) => k !== 'name' && x)) } as Theme;
  const s = document.documentElement.style;
  for (const [k, x] of Object.entries(v)) if (x) s.setProperty(`--${k}`, x);
  document.documentElement.dataset.theme = (t.name ?? document.documentElement.dataset.theme) === 'light' ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', v.bg ?? '#000000');
  try { if (t.name) localStorage.setItem(KEY, t.name); } catch { /* storage unavailable */ }
}
export function restoreTheme() {
  try { const n = localStorage.getItem(KEY); if (n && THEMES[n] && n !== 'default') setTheme({ name: n }); } catch { /* storage unavailable */ }
}

function overlay(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.setAttribute('aria-hidden', 'true');
  Object.assign(c.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '9999' });
  c.width = innerWidth * devicePixelRatio;
  c.height = innerHeight * devicePixelRatio;
  document.body.appendChild(c);
  const ctx = c.getContext('2d')!;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  return [c, ctx];
}

export function confetti() {
  if (reduced()) return;
  const [c, ctx] = overlay();
  const fg = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#fff';
  const colors = [fg, '#808080', '#c0c0c0'];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 14, vy: Math.random() * -12 - 4,
    r: Math.random() * 6 + 3, c: colors[(Math.random() * colors.length) | 0], a: Math.random() * Math.PI,
  }));
  const start = performance.now();
  const tick = (t: number) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.a += 0.2;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
    }
    if (t - start < 2800) requestAnimationFrame(tick); else c.remove();
  };
  requestAnimationFrame(tick);
}

export function matrix() {
  if (reduced()) return;
  const [c, ctx] = overlay();
  const size = 16;
  const cols = Math.ceil(innerWidth / size);
  const drops = Array.from({ length: cols }, () => Math.random() * -40);
  const chars = 'アイウエオカキクケコサシスセソ01WHOLDEN';
  const start = performance.now();
  const tick = (t: number) => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    ctx.fillStyle = '#ffffff';
    ctx.font = `${size}px monospace`;
    drops.forEach((y, i) => {
      ctx.fillText(chars[(Math.random() * chars.length) | 0], i * size, y * size);
      drops[i] = y * size > innerHeight && Math.random() > 0.97 ? 0 : y + 1;
    });
    if (t - start < 5000) requestAnimationFrame(tick);
    else { c.style.transition = 'opacity 600ms'; c.style.opacity = '0'; setTimeout(() => c.remove(), 700); }
  };
  requestAnimationFrame(tick);
}

// A pixel chicken walks across the bottom of the page inside a YOLO-style box. Thesis nod.
export function chicken() {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div style="position:relative;border:2px solid #fff;padding:6px 8px 4px;background:#000">
    <span style="position:absolute;top:-1.35em;left:-2px;background:#fff;color:#000;font:600 11px/1.3 ui-monospace,monospace;padding:1px 5px">broiler 0.99</span>
    <svg width="48" height="48" viewBox="0 0 12 12" shape-rendering="crispEdges">
      <rect x="6" y="1" width="2" height="1" fill="#ffffff"/><rect x="5" y="2" width="4" height="3" fill="#ffffff"/>
      <rect x="9" y="3" width="2" height="1" fill="#bdbdbd"/><rect x="7" y="3" width="1" height="1" fill="#000000"/>
      <rect x="2" y="5" width="8" height="4" fill="#ffffff"/><rect x="1" y="4" width="2" height="3" fill="#e0e0e0"/>
      <rect x="4" y="6" width="3" height="2" fill="#cfcfcf"/><rect x="4" y="9" width="1" height="2" fill="#bdbdbd"/><rect x="7" y="9" width="1" height="2" fill="#bdbdbd"/>
    </svg></div>`;
  Object.assign(el.style, { position: 'fixed', bottom: '18px', left: '-90px', zIndex: '9999', pointerEvents: 'none' });
  document.body.appendChild(el);
  if (reduced()) { el.style.left = '16px'; setTimeout(() => el.remove(), 3000); return; }
  const anim = el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${innerWidth + 120}px)` }], { duration: 7000, easing: 'linear' });
  el.firstElementChild!.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)' }, { transform: 'translateY(0)' }], { duration: 300, iterations: Infinity });
  anim.onfinish = () => el.remove();
}

export function runEffect(effect: string, theme?: Theme & { name?: string }) {
  if (effect === 'confetti') confetti();
  else if (effect === 'matrix') matrix();
  else if (effect === 'chicken') chicken();
  else if (effect === 'konami') { confetti(); chicken(); }
  else if (effect === 'theme' && theme) setTheme(theme);
}
