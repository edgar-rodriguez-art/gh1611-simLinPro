import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseJsonStatSeries,
  monthlyVolatility,
  sectorFromSeries,
  parseWorldBank,
  isStale,
  fetchEurostat,
  productionUrl,
} from '../src/data/eurostat.js';
import { resolveMetrics, loadMetrics, NACE_BY_SECTOR, toEngineMetrics } from '../src/data/metrics.js';

const fx = (f) => JSON.parse(readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8'));

function fixtureFetch({ failSca = false, offline = false } = {}) {
  return async (url) => {
    if (offline) throw new Error('fetch failed');
    let f = null;
    if (url.includes('prc_hicp_manr')) f = 'eurostat-hicp.json';
    else if (url.includes('nace_r2=')) {
      if (failSca && url.includes('s_adj=SCA')) return { ok: false, status: 404, json: async () => ({}) };
      f = 'eurostat-' + /nace_r2=(C\d+)/.exec(url)[1] + '.json';
    } else if (url.includes('FP.CPI')) f = 'worldbank-cpi.json';
    else if (url.includes('NV.IND')) f = 'worldbank-manuf.json';
    else if (url.includes('metrics.json'))
      return { ok: true, json: async () => JSON.parse(readFileSync('data/metrics.json', 'utf8')) };
    return { ok: !!f, status: f ? 200 : 404, json: async () => fx(f) };
  };
}

describe('Eurostat JSON-stat', () => {
  it('convierte el dataset en una serie ordenada', () => {
    const s = parseJsonStatSeries(fx('eurostat-C10.json'));
    expect(s).toHaveLength(24);
    expect(s[0].period < s[23].period).toBe(true);
    expect(typeof s[0].value).toBe('number');
  });
  it('JSON-stat con valores en array y varias dimensiones', () => {
    const j = {
      id: ['geo', 'time'],
      size: [1, 3],
      dimension: {
        geo: { category: { index: { ES: 0 } } },
        time: { category: { index: { '2026-01': 0, '2026-02': 1, '2026-03': 2 } } },
      },
      value: [100, 110, 99],
    };
    expect(parseJsonStatSeries(j).map((x) => x.value)).toEqual([100, 110, 99]);
  });
  it('volatilidad = desviación de variaciones mensuales', () => {
    const s = [100, 110, 99].map((v, i) => ({ period: '2026-0' + (i + 1), value: v }));
    // variaciones: +0.1, -0.1 → desviación típica muestral = 0.1414
    expect(monthlyVolatility(s)).toBeCloseTo(0.1414, 3);
    expect(sectorFromSeries(s, {}).index).toBe(99);
  });
  it('detecta series desactualizadas', () => {
    expect(isStale('2026-01', new Date('2026-11-14'))).toBe(true);
    expect(isStale('2026-08', new Date('2026-11-14'))).toBe(false);
  });
  it('Banco Mundial: último valor no nulo', () => {
    expect(parseWorldBank(fx('worldbank-cpi.json'))).toEqual({ value: 2.7, period: '2025' });
  });
  it('URL con un nace_r2 por petición y s_adj', () => {
    const u = productionUrl('C26', 'NSA');
    expect(u).toContain('sts_inpr_m?');
    expect(u).toContain('nace_r2=C26');
    expect(u).toContain('s_adj=NSA');
    expect(u).toContain('lastTimePeriod=24');
  });
  it('prueba SCA → CA si falta la serie', async () => {
    const r = await fetchEurostat(fixtureFetch({ failSca: true }), NACE_BY_SECTOR);
    expect(r.sectors.bakery.s_adj).toBe('CA');
    expect(r.hicp.rate).toBeTypeOf('number');
  });
});

describe('cascada de respaldo', () => {
  it('1) Eurostat en vivo', async () => {
    const m = await loadMetrics({ fetchFn: fixtureFetch(), cacheUrl: 'data/metrics.json' });
    expect(m.fuente).toBe('eurostat');
    expect(m.sectors.textile.via).toBe('en-vivo');
  });
  it('2) sin red → caché → 4) por defecto', async () => {
    const m = await loadMetrics({ fetchFn: fixtureFetch({ offline: true }), cacheUrl: 'data/metrics.json' });
    expect(m.sectors.bakery.index).toBe(100);
    expect(m.hicp.via).toBe('por-defecto');
  });
  it('3) Banco Mundial si no hay IPCA en vivo ni en caché', () => {
    const wb = { hicp: { rate: 2.7, period: '2025', fuente: 'banco-mundial' } };
    const m = resolveMetrics({ live: { sectors: {} }, cache: null, wb });
    expect(m.hicp.fuente).toBe('banco-mundial');
    expect(m.sectors.electronics.via).toBe('por-defecto');
  });
  it('caché antes que Banco Mundial', () => {
    const cache = {
      sectors: { bakery: { index: 104, sigma: 0.01, fuente: 'eurostat' } },
      hicp: { rate: 2.1, fuente: 'eurostat' },
    };
    const m = resolveMetrics({ live: null, cache, wb: { hicp: { rate: 9, fuente: 'banco-mundial' } } });
    expect(m.hicp.rate).toBe(2.1);
    expect(m.sectors.bakery.via).toBe('cache');
    expect(toEngineMetrics(m).sectors.bakery.index).toBe(104);
  });
});
