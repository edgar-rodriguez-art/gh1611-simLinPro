// @ts-check
// HUD genérico de un puesto: caja, estado, KPI con miniaturas y controles de los parámetros de §4.3.
import { h, fmt, sparkline } from './dom.js';
import { PARAM_DEFS, SECTORS, SUPPLIERS, INSPECTION, ROLE_LABELS, parseSlot } from '../config.js';
import { iconSvg } from './icons.js';

const ENUM_LABELS = {
  supplier: (k) => SUPPLIERS[k].label,
  inspection: (k) => INSPECTION[k].label,
};

/**
 * @param {{slot:string, kpis:{key:string,label:string,f:(x:number)=>string, good?:'up'|'down'}[],
 *          status:(data:any)=>string, entityKey:string, onChange:(changes:Record<string,any>)=>void,
 *          extra?:HTMLElement[]}} o
 */
export function buildRoleHud(o) {
  const ps = /** @type {{role:'producer'|'distributor'|'buyer', sector:'bakery'|'textile'|'electronics'}} */ (
    parseSlot(o.slot)
  );
  const defs = PARAM_DEFS[ps.role];
  const root = h('div', { class: 'stack' });
  const controller = h('span', { class: 'chip' });
  const cash = h('div', { class: 'cash', text: '—' });
  const status = h('div', { class: 'muted tiny' });
  root.append(
    h('section', { class: 'section' }, [
      h('header', {}, [
        h('h3', { text: `${ROLE_LABELS[ps.role]} · ${SECTORS[ps.sector].label}` }),
        controller,
      ]),
      h('div', { class: 'row' }, [h('span', { class: 'muted tiny', text: 'Caja' }), cash]),
      status,
    ]),
  );

  // KPI con miniaturas
  const tiles = {};
  const kpiGrid = h('div', { class: 'kpis' });
  for (const k of o.kpis) {
    const value = h('div', { class: 'value', text: '—' });
    const canvas = h('canvas', { 'aria-hidden': 'true' });
    kpiGrid.append(h('div', { class: 'kpi' }, [h('div', { class: 'label', text: k.label }), value, canvas]));
    tiles[k.key] = { value, canvas, def: k };
  }
  root.append(
    h('section', { class: 'section' }, [
      h('header', {}, [h('h3', { text: 'Mis KPI (último día)' })]),
      kpiGrid,
    ]),
  );

  // Parámetros
  const controls = {};
  let pending = {};
  let timer = /** @type {any} */ (null);
  const send = (k, v) => {
    pending[k] = v;
    clearTimeout(timer);
    timer = setTimeout(() => {
      o.onChange(pending);
      pending = {};
    }, 200);
  };
  const params = h('div', { class: 'stack' });
  for (const [key, d] of Object.entries(defs)) {
    if (d.type === 'enum') {
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': d.label });
      const btns = d.options.map((opt) => {
        const b = h('button', {
          type: 'button',
          text: ENUM_LABELS[key] ? ENUM_LABELS[key](opt) : opt,
          onclick: () => {
            btns.forEach((x) => x.classList.toggle('on', x === b));
            send(key, opt);
          },
        });
        b.dataset.value = opt;
        return b;
      });
      seg.append(...btns);
      const hint = key === 'supplier' ? h('div', { class: 'muted tiny' }) : null;
      params.append(
        h('div', { class: 'param' }, [h('div', { class: 'top' }, [h('span', { text: d.label })]), seg, hint]),
      );
      controls[key] = {
        set: (v) => {
          btns.forEach((x) => x.classList.toggle('on', x.dataset.value === v));
          if (hint) {
            const s = SUPPLIERS[v];
            hint.textContent = `Plazo mediano ${s.leadDays} d · precio ×${s.priceFactor} · defectos +${(s.defectAdd * 100).toFixed(1)} pp`;
          }
        },
      };
    } else {
      const [lo, hi] = d.range(ps.sector);
      const out = h('b', { text: '' });
      const input = /** @type {HTMLInputElement} */ (
        h('input', { type: 'range', min: lo, max: hi, step: d.step || 1, 'aria-label': d.label })
      );
      let dragging = false;
      input.addEventListener('pointerdown', () => (dragging = true));
      input.addEventListener('input', () => (out.textContent = fmtParam(key, Number(input.value))));
      input.addEventListener('change', () => {
        dragging = false;
        send(key, Number(input.value));
      });
      params.append(
        h('div', { class: 'param' }, [
          h('div', { class: 'top' }, [h('span', { text: d.label }), out]),
          input,
        ]),
      );
      controls[key] = {
        set: (v) => {
          if (dragging || document.activeElement === input) return;
          input.value = String(v);
          out.textContent = fmtParam(key, v);
        },
      };
    }
  }
  root.append(
    h('section', { class: 'section' }, [
      h('header', {}, [
        h('h3', { text: 'Mis parámetros' }),
        h('span', { class: 'tiny muted', text: 'el anfitrión aplica límites' }),
      ]),
      params,
    ]),
  );
  if (o.extra) root.append(...o.extra);

  return {
    el: root,
    /**
     * @param {any} data snapshot
     * @param {any[]} hist historial de KPI ({day, slots})
     */
    update(data, hist) {
      const ent = data[o.entityKey];
      if (!ent) return;
      cash.textContent = fmt.eur(ent.cash);
      cash.classList.toggle('neg', ent.cash < 0);
      status.textContent = o.status(data);
      const ctl = data.slots?.[o.slot];
      const human = ctl?.controller === 'human';
      controller.innerHTML = human
        ? `${iconSvg('human', 14)} Humano`
        : `${iconSvg('bot', 14)} ${ctl?.conservative ? 'BOT conservador' : 'BOT'}`;
      controller.className = 'chip ' + (human ? 'ok' : 'warn');
      for (const [k, c] of Object.entries(controls)) if (k in ent.params) c.set(ent.params[k]);
      const today = data.kpi?.[o.slot];
      for (const [k, t] of Object.entries(tiles)) {
        const v = today ? today[k] : undefined;
        t.value.textContent = v === undefined ? '—' : t.def.f(v);
      }
      if (hist && hist.length) {
        for (const [k, t] of Object.entries(tiles)) {
          sparkline(
            t.canvas,
            hist.slice(-20).map((d) => d.slots?.[o.slot]?.[k]),
          );
        }
      }
    },
  };
}

function fmtParam(key, v) {
  if (key === 'price') return fmt.eur2(v);
  if (key === 'maintenance' || key === 'margin' || key.startsWith('basket') || key.endsWith('Pct'))
    return v + ' %';
  if (key === 'reorderDays' || key === 's' || key === 'Q' || key === 'safetyDays' || key === 'orderEvery')
    return v + ' d';
  return String(v);
}

export const KPI_FMT = { pct: fmt.pct, eur: fmt.eur, num: fmt.num, int: fmt.int, hours: fmt.hours };
