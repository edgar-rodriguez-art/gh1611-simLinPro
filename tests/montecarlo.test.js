import { describe, it, expect } from 'vitest';
import { Engine } from '../src/sim/engine.js';
import { buildCandidates, runScenarios, compare } from '../src/sim/montecarlo.js';
import { analyzeSlot, localRunner } from '../src/sim/proposals.js';
import { percentile } from '../src/sim/kpi.js';
import { defaultParams } from '../src/config.js';

function snap() {
  const e = Engine.create({ seed: 2026, days: 40 });
  e.runDays(4);
  return e.snapshotForMC();
}

describe('Monte Carlo', () => {
  it('genera candidatos ±10/±20 % o el valor discreto vecino', () => {
    const c = buildCandidates('producer-bakery', defaultParams('producer', 'bakery'));
    const ids = c.map((x) => x.id);
    expect(ids).toContain('lotSize=120');
    expect(ids).toContain('lotSize=180');
    expect(ids).toContain('shifts=1');
    expect(ids).toContain('shifts=3');
    expect(ids).toContain('supplier=A');
    expect(ids).toContain('supplier=C');
    expect(ids).toContain('inspection=high');
  });

  it('es reproducible con la misma semilla base', () => {
    const s = snap();
    const job = { snapshot: s, slot: 'buyer-textile', scenarios: [{ id: 'base', changes: null }], n: 20, baseSeed: 7, horizonDays: 3 };
    expect(runScenarios(job)).toEqual(runScenarios(job));
    // repartir réplicas en rangos da lo mismo
    const a = runScenarios({ ...job, n: 10 });
    const b = runScenarios({ ...job, n: 10, startRep: 10 });
    expect([...a.base.profit, ...b.base.profit]).toEqual(runScenarios(job).base.profit);
  });

  it('percentiles estables (±2 %) entre ejecuciones con N=2000', () => {
    const s = snap();
    const job = (baseSeed) => ({ snapshot: s, slot: 'buyer-textile', scenarios: [{ id: 'base', changes: null }], n: 2000, baseSeed, horizonDays: 14 });
    const r1 = runScenarios(job(1)).base.profit;
    const r2 = runScenarios(job(2)).base.profit;
    for (const p of [50, 95]) {
      const a = percentile(r1, p);
      const b = percentile(r2, p);
      expect(Math.abs(a - b) / Math.abs(a)).toBeLessThan(0.02);
    }
  });

  it('compara con réplicas emparejadas: un escenario idéntico no mejora', () => {
    const s = snap();
    const r = runScenarios({
      snapshot: s,
      slot: 'producer-textile',
      scenarios: [{ id: 'base', changes: null }, { id: 'same', changes: { shifts: 2 } }],
      n: 30,
      baseSeed: 3,
      horizonDays: 2,
    });
    const c = compare(r.base, r.same);
    expect(c.deltaProfit).toBe(0);
    expect(c.pImprove).toBe(0.5);
    expect(c.riskP5).toBe(0);
  });

  it('analiza un puesto, reduce N si no cabe en el presupuesto y avisa', async () => {
    const s = snap();
    const res = await analyzeSlot({
      snapshot: s,
      slot: 'distributor-bakery',
      params: s.distributors.bakery.params,
      n: 1000,
      baseSeed: 11,
      runner: localRunner(),
      budgetMs: 500,
      horizonDays: 3,
    });
    expect(res.ranking.length).toBeGreaterThan(5);
    expect(res.nUsed).toBeLessThan(1000);
    expect(res.reduced).toBe(true);
    for (const c of res.ranking) {
      expect(c.stats.pImprove).toBeGreaterThanOrEqual(0);
      expect(c.stats.pImprove).toBeLessThanOrEqual(1);
    }
  });
});
