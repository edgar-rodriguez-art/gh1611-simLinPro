// @ts-check
// Modal de propuesta: antes → después, Δ esperada, P(mejora) y riesgo. Expira en 90 s (cuenta como rechazada).
import { h, fmt } from './dom.js';
import { PARAM_DEFS, SUPPLIERS, INSPECTION, parseSlot } from '../config.js';
import { ROLE_KPIS } from '../sim/montecarlo.js';

export function paramValueLabel(key, v) {
  if (key === 'supplier') return SUPPLIERS[v]?.label || v;
  if (key === 'inspection') return INSPECTION[v]?.label || v;
  if (key === 'price') return fmt.eur2(v);
  return String(v);
}

/**
 * @param {{proposal:any, onAnswer:(accept:boolean)=>void}} o
 * @returns {{close:()=>void}}
 */
export function showProposal({ proposal: p, onAnswer }) {
  const ps = /** @type {{role:'producer'|'distributor'|'buyer'}} */ (parseSlot(p.slot));
  const defs = PARAM_DEFS[ps.role];
  const kdefs = ROLE_KPIS[ps.role];
  const ttl = p.ttlMs || 90000;
  const t0 = performance.now();
  let done = false;
  const bar = h('div', { style: { width: '100%' } });
  const secs = h('span', { class: 'tiny muted' });
  const answer = (accept) => {
    if (done) return;
    done = true;
    clearInterval(iv);
    back.remove();
    onAnswer(accept);
  };
  const changes = Object.entries(p.changes).map(([k, v]) =>
    h('div', { class: 'change' }, [
      h('span', { class: 'grow', text: defs[k]?.label || k }),
      h('span', { class: 'muted', text: paramValueLabel(k, p.before?.[k]) }),
      h('span', { text: '→' }),
      h('b', { text: paramValueLabel(k, v) }),
    ]),
  );
  const d = p.delta || {};
  const kv = (label, value, cls = '') => h('div', { class: 'kpi' }, [h('div', { class: 'label', text: label }), h('div', { class: 'value ' + cls, text: value })]);
  const sign = (x) => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
  const fmtK = (def, x) => (def.fmt === 'pct' ? fmt.signed(x * 100, fmt.num) + ' pp' : fmt.signed(x));
  const back = h('div', { class: 'modal-back', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'prop-title' }, [
    h('div', { class: 'modal' }, [
      h('h2', { id: 'prop-title', text: 'Propuesta de mejora del anfitrión' }),
      h('p', { class: 'muted tiny', text: `Monte Carlo a 14 días${p.kpiLabel ? ' · ' + p.kpiLabel : ''}. Tú decides.` }),
      ...changes,
      h('div', { class: 'kpis' }, [
        kv('Δ beneficio esperado (14 d)', fmt.signed(d.profit, fmt.eur), sign(d.profit)),
        kv('Probabilidad de mejora', fmt.pct(p.pImprove)),
        kv(`Δ ${kdefs[0].label}`, fmtK(kdefs[0], d.k1), sign(d.k1)),
        kv(`Δ ${kdefs[1].label}`, fmtK(kdefs[1], d.k2), sign(kdefs[1].lowerIsBetter ? -d.k2 : d.k2)),
        kv('Riesgo (empeora P5)', p.riskP5 > 0 ? fmt.pct(p.riskP5) : 'no empeora', p.riskP5 > 0.05 ? 'neg' : ''),
      ]),
      h('div', { class: 'timer' }, [bar]),
      secs,
      h('div', { class: 'row' }, [
        h('button', { class: 'ok grow', text: 'Aceptar', onclick: () => answer(true) }),
        h('button', { class: 'bad grow', text: 'Rechazar', onclick: () => answer(false) }),
      ]),
    ]),
  ]);
  document.body.append(back);
  /** @type {HTMLButtonElement|null} */ (back.querySelector('button.ok'))?.focus();
  const iv = setInterval(() => {
    const left = Math.max(0, ttl - (performance.now() - t0));
    bar.style.width = (100 * left) / ttl + '%';
    secs.textContent = `Caduca en ${Math.ceil(left / 1000)} s (si caduca, cuenta como rechazada)`;
    if (left <= 0 && !done) {
      // el anfitrión la marca como expirada (cuenta como rechazada); aquí solo se cierra
      done = true;
      clearInterval(iv);
      back.remove();
    }
  }, 250);
  return { close: () => answer(false) };
}
