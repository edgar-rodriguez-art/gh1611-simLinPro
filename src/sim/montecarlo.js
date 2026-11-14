// @ts-check
// Núcleo de Monte Carlo (sin dependencias del navegador): lo usan el Web Worker y las pruebas.
import { Engine } from './engine.js';
import { hash32 } from './rng.js';
import { PARAM_DEFS, clampParams, parseSlot, MC_HORIZON_DAYS } from '../config.js';
import { mean, percentile } from './kpi.js';

/** KPI clave por rol: objetivo (beneficio) y dos secundarios. */
export const ROLE_KPIS = {
  producer: [
    { key: 'oee', label: 'OEE', fmt: 'pct' },
    { key: 'fillRate', label: 'Fill rate', fmt: 'pct' },
  ],
  distributor: [
    { key: 'otif', label: 'OTIF', fmt: 'pct' },
    { key: 'fleetUtil', label: 'Utilización de flota', fmt: 'pct' },
  ],
  buyer: [
    { key: 'fillRate', label: 'Fill rate', fmt: 'pct' },
    { key: 'lost', label: 'Ventas perdidas (u/día)', fmt: 'num', lowerIsBetter: true },
  ],
};

/**
 * Candidatos: un parámetro a la vez con ±10 % y ±20 % (o valor anterior/siguiente si es discreto).
 * @returns {{id:string, param:string, changes:Record<string,any>}[]}
 */
export function buildCandidates(slot, params) {
  const ps = parseSlot(slot);
  if (!ps) return [];
  const defs = PARAM_DEFS[ps.role];
  const out = [];
  const seen = new Set();
  for (const [key, d] of Object.entries(defs)) {
    const cur = params[key];
    /** @type {any[]} */
    let values = [];
    if (d.type === 'enum') {
      const i = d.options.indexOf(cur);
      if (i > 0) values.push(d.options[i - 1]);
      if (i < d.options.length - 1) values.push(d.options[i + 1]);
    } else {
      const [lo, hi] = d.range(ps.sector);
      for (const f of [-0.2, -0.1, 0.1, 0.2]) {
        let v = cur * (1 + f);
        v = d.type === 'int' ? Math.round(v) : Math.round(v * 100) / 100;
        if (v === cur) v = cur + Math.sign(f) * (d.step || 1);
        if (v < lo || v > hi) continue;
        values.push(v);
      }
    }
    for (const v of values) {
      const changes = clampParams(ps.role, ps.sector, params, { [key]: v });
      if (!Object.keys(changes).length || changes[key] === cur) continue;
      const id = key + '=' + changes[key];
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, param: key, changes });
    }
  }
  return out;
}

/** Combina dos candidatos de parámetros distintos. */
export function combine(a, b) {
  return { id: a.id + ' + ' + b.id, param: a.param + '+' + b.param, changes: { ...a.changes, ...b.changes } };
}

/**
 * Simula `n` réplicas de cada escenario desde el snapshot. Usa números aleatorios comunes:
 * la réplica r usa la semilla hash(baseSeed, r) en todos los escenarios.
 * @param {{snapshot:any, slot:string, scenarios:{id:string, changes:Record<string,any>|null}[], n:number,
 *          startRep?:number, baseSeed:number, horizonDays?:number}} job
 */
export function runScenarios(job) {
  const { snapshot, slot, scenarios, n, baseSeed } = job;
  const startRep = job.startRep || 0;
  const horizonH = Math.round((job.horizonDays || MC_HORIZON_DAYS) * 24);
  const ps = /** @type {{role:'producer'|'distributor'|'buyer'}} */ (parseSlot(slot));
  const kdefs = ROLE_KPIS[ps.role];
  /** @type {Record<string, {profit:number[], k1:number[], k2:number[]}>} */
  const res = {};
  for (const sc of scenarios) res[sc.id] = { profit: [], k1: [], k2: [] };
  for (let r = 0; r < n; r++) {
    const seed = hash32(baseSeed, startRep + r);
    for (const sc of scenarios) {
      const eng = Engine.fromState(snapshot, { seed });
      eng.emitEvents = false;
      eng.state.days = 100000;
      eng.state.over = false;
      eng.state.kpiDaily = [];
      if (sc.changes) eng.setParams(slot, sc.changes, 'propuesta');
      const cash0 = eng.cashOf(slot);
      eng.runHours(horizonH);
      const kd = eng.state.kpiDaily;
      const k1 = mean(kd.map((d) => d.slots[slot][kdefs[0].key]));
      const k2 = mean(kd.map((d) => d.slots[slot][kdefs[1].key]));
      res[sc.id].profit.push(eng.cashOf(slot) - cash0);
      res[sc.id].k1.push(k1);
      res[sc.id].k2.push(k2);
    }
  }
  return res;
}

/** Une resultados parciales (en orden de réplica). */
export function mergeResults(parts) {
  /** @type {Record<string, {profit:number[], k1:number[], k2:number[]}>} */
  const out = {};
  for (const part of parts) {
    for (const [id, r] of Object.entries(part)) {
      const o = (out[id] ||= { profit: [], k1: [], k2: [] });
      o.profit.push(...r.profit);
      o.k1.push(...r.k1);
      o.k2.push(...r.k2);
    }
  }
  return out;
}

/**
 * Compara un candidato con la línea base (réplicas emparejadas).
 * riskP5 > 0 significa que el P5 del beneficio empeora (fracción relativa).
 */
export function compare(base, cand) {
  const n = Math.min(base.profit.length, cand.profit.length);
  const diffs = new Array(n);
  let better = 0;
  for (let i = 0; i < n; i++) {
    diffs[i] = cand.profit[i] - base.profit[i];
    if (diffs[i] > 1e-9) better += 1;
    else if (Math.abs(diffs[i]) <= 1e-9) better += 0.5;
  }
  const p5b = percentile(base.profit, 5);
  const p5c = percentile(cand.profit, 5);
  return {
    n,
    deltaProfit: mean(diffs),
    deltaK1: mean(cand.k1) - mean(base.k1),
    deltaK2: mean(cand.k2) - mean(base.k2),
    pImprove: n ? better / n : 0,
    riskP5: (p5b - p5c) / Math.max(1, Math.abs(p5b)),
    p5: percentile(cand.profit, 5),
    p50: percentile(cand.profit, 50),
    p95: percentile(cand.profit, 95),
    dP5: percentile(diffs, 5),
    dP50: percentile(diffs, 50),
    dP95: percentile(diffs, 95),
  };
}

/** Resumen de una distribución (P5/P50/P95 y media). */
export function describe(values) {
  return {
    mean: mean(values),
    p5: percentile(values, 5),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
  };
}

/** Histograma de `bins` cubetas. */
export function histogram(values, bins = 20) {
  if (!values.length) return { edges: [], counts: [] };
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi === lo) hi = lo + 1;
  const w = (hi - lo) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
  const edges = Array.from({ length: bins }, (_, i) => lo + w * (i + 0.5));
  return { edges, counts };
}

/** Histograma de dos distribuciones con las mismas cubetas (para compararlas). */
export function histogram2(a, b, bins = 24) {
  const all = [...a, ...b];
  if (!all.length) return { edges: [], a: [], b: [] };
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of all) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi === lo) hi = lo + 1;
  const w = (hi - lo) / bins;
  const ca = new Array(bins).fill(0);
  const cb = new Array(bins).fill(0);
  for (const v of a) ca[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
  for (const v of b) cb[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
  return { edges: Array.from({ length: bins }, (_, i) => lo + w * (i + 0.5)), a: ca, b: cb };
}
