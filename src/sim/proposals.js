// @ts-check
// Orquestación de Monte Carlo (§7): cribado de candidatos, top 3, combinaciones y presupuesto de 3 s.
import { buildCandidates, combine, mergeResults, compare, histogram, describe, runScenarios } from './montecarlo.js';
import { MC_BUDGET_MS, MC_DEFAULT_N, MC_HORIZON_DAYS, parseSlot } from '../config.js';

const SCREEN_N = 30;

/** Ejecutor en el hilo actual (pruebas y respaldo si no hay Workers). */
export function localRunner() {
  return {
    size: 1,
    async run(job) {
      const t0 = performance.now();
      const results = runScenarios(job);
      return { results, ms: performance.now() - t0 };
    },
    terminate() {},
  };
}

/** Grupo de Web Workers. */
export function workerPool(size) {
  const workers = Array.from(
    { length: size },
    () => new Worker(new URL('./montecarlo.worker.js', import.meta.url), { type: 'module' }),
  );
  let seq = 0;
  const pending = new Map();
  workers.forEach((w) => {
    w.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
  });
  let rr = 0;
  return {
    size,
    run(job) {
      const id = ++seq;
      const w = workers[rr++ % workers.length];
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ ...job, id });
      });
    },
    terminate() {
      workers.forEach((w) => w.terminate());
    },
  };
}

/** Reparte `n` réplicas entre los ejecutores por rangos y une en orden (resultado independiente del reparto). */
async function runSplit(runner, base, n) {
  const k = Math.max(1, Math.min(runner.size, n));
  const per = Math.ceil(n / k);
  const jobs = [];
  for (let i = 0; i < k; i++) {
    const start = i * per;
    const cnt = Math.min(per, n - start);
    if (cnt <= 0) break;
    jobs.push(runner.run({ ...base, n: cnt, startRep: start }));
  }
  const parts = await Promise.all(jobs);
  return { results: mergeResults(parts.map((p) => p.results)), ms: Math.max(...parts.map((p) => p.ms)) };
}

/**
 * Ejecuta el análisis de un puesto.
 * @param {{snapshot:any, slot:string, params:Record<string,any>, n?:number, baseSeed:number,
 *          runner:any, budgetMs?:number, horizonDays?:number, now?:()=>number, onProgress?:(p:any)=>void}} o
 */
export async function analyzeSlot(o) {
  const now = o.now || (() => performance.now());
  const t0 = now();
  const N = o.n || MC_DEFAULT_N;
  const budget = o.budgetMs ?? MC_BUDGET_MS;
  const horizonDays = o.horizonDays || MC_HORIZON_DAYS;
  const cands = buildCandidates(o.slot, o.params);
  const common = { snapshot: o.snapshot, slot: o.slot, baseSeed: o.baseSeed, horizonDays };

  // Etapa 1: cribado de todos los candidatos (un parámetro a la vez)
  const screenN = Math.min(SCREEN_N, N);
  const scen1 = [{ id: 'base', changes: null }, ...cands];
  o.onProgress?.({ stage: 1, total: scen1.length });
  const s1 = await runSplit(o.runner, { ...common, scenarios: scen1 }, screenN);
  const elapsed1 = now() - t0;
  const msPerRun = Math.max(0.05, elapsed1 / (scen1.length * screenN)) * o.runner.size;

  const ranked1 = cands
    .map((c) => ({ ...c, stats: compare(s1.results.base, s1.results[c.id]) }))
    .sort((a, b) => b.stats.deltaProfit - a.stats.deltaProfit);
  const top3 = ranked1.slice(0, 3);
  const combos = [];
  for (let i = 0; i < top3.length; i++)
    for (let j = i + 1; j < top3.length; j++)
      if (top3[i].param !== top3[j].param) combos.push(combine(top3[i], top3[j]));

  // Etapa 2: base + top 3 + combinaciones con el N que quepa en el presupuesto
  const scen2 = [{ id: 'base', changes: null }, ...top3.map(({ id, param, changes }) => ({ id, param, changes })), ...combos];
  const remaining = Math.max(0, budget - elapsed1);
  const fit = Math.floor((remaining * o.runner.size) / (msPerRun * scen2.length));
  const nEff = Math.max(screenN, Math.min(N, fit));
  o.onProgress?.({ stage: 2, total: scen2.length, n: nEff });
  const s2 = await runSplit(o.runner, { ...common, scenarios: scen2 }, nEff);
  const base2 = s2.results.base;

  const finals = scen2
    .filter((s) => s.id !== 'base')
    .map((s) => ({ ...s, n: nEff, stats: compare(base2, s2.results[s.id]) }));
  const rest = ranked1.slice(3).map((c) => ({ ...c, n: screenN }));
  const ranking = [...finals.sort((a, b) => b.stats.deltaProfit - a.stats.deltaProfit), ...rest];
  const best = finals[0];
  const ms = now() - t0;
  return {
    slot: o.slot,
    role: parseSlot(o.slot)?.role,
    nRequested: N,
    nUsed: nEff,
    reduced: nEff < N,
    ms,
    horizonDays,
    baseline: describe(base2.profit),
    baseK: { k1: describe(base2.k1), k2: describe(base2.k2) },
    ranking,
    histBase: histogram(base2.profit, 24),
    histBest: best ? histogram(s2.results[best.id].profit, 24) : null,
    bestId: best ? best.id : null,
  };
}
