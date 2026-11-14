// @ts-check
// Utilidades de DOM y formato (sin framework).

/**
 * Crea un elemento. `attrs` admite class, text, html, on* (eventos) y atributos normales.
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {(Node|string|null|undefined|false)[]} [children]
 */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

export const fmt = {
  eur: (x) => (Number.isFinite(x) ? eur.format(x) : '—'),
  eur2: (x) => (Number.isFinite(x) ? eur2.format(x) : '—'),
  num: (x) => (Number.isFinite(x) ? num.format(x) : '—'),
  int: (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString('es-ES') : '—'),
  pct: (x) => (Number.isFinite(x) ? num.format(x * 100) + ' %' : '—'),
  signed: (x, f = fmt.num) => (Number.isFinite(x) ? (x > 0 ? '+' : '') + f(x) : '—'),
  hours: (x) => (Number.isFinite(x) ? num.format(x) + ' h' : '—'),
};

/** Notificación breve. */
export function toast(text, ms = 3500) {
  let area = document.querySelector('.toast-area');
  if (!area) {
    area = h('div', { class: 'toast-area', role: 'status', 'aria-live': 'polite' });
    document.body.append(area);
  }
  const t = h('div', { class: 'toast', text });
  area.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Minigráfica (sparkline) en un canvas. */
export function sparkline(canvas, values, color = '#5b3fb8') {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = (canvas.width = canvas.clientWidth * 2 || 160);
  const hgt = (canvas.height = canvas.clientHeight * 2 || 52);
  ctx.clearRect(0, 0, w, hgt);
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  v.forEach((x, i) => {
    const px = (i / (v.length - 1)) * (w - 4) + 2;
    const py = hgt - 3 - ((x - lo) / span) * (hgt - 6);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
}

export function isMobile() {
  return (
    window.matchMedia('(max-width: 820px)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
  );
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
