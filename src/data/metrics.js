// @ts-check
// Métricas reales de España con respaldo en cascada (§6):
// (1) Eurostat en vivo → (2) data/metrics.json (caché de la Action) → (3) Banco Mundial → (4) config.js.
import { DEFAULT_METRICS, SECTOR_IDS, SECTORS } from '../config.js';
import { fetchEurostat, fetchWorldBank, fetchJson } from './eurostat.js';

export const NACE_BY_SECTOR = Object.fromEntries(SECTOR_IDS.map((s) => [s, SECTORS[s].eurostatNace]));

function validSector(x) {
  return x && typeof x.index === 'number' && x.index > 10 && x.index < 400 && typeof x.sigma === 'number';
}
function validHicp(x) {
  return x && typeof x.rate === 'number' && x.rate > -10 && x.rate < 50;
}

/**
 * Combina las fuentes elemento a elemento (función pura).
 * @param {{live?:any, cache?:any, wb?:any, defaults?:any}} src
 */
export function resolveMetrics({ live, cache, wb, defaults = DEFAULT_METRICS }) {
  /** @type {Record<string, any>} */
  const sectors = {};
  for (const s of SECTOR_IDS) {
    if (live && validSector(live.sectors?.[s])) sectors[s] = { ...live.sectors[s], via: 'en-vivo' };
    else if (cache && validSector(cache.sectors?.[s])) sectors[s] = { ...cache.sectors[s], via: 'cache' };
    else sectors[s] = { ...defaults.sectors[s], via: 'por-defecto' };
  }
  let hicp;
  if (live && validHicp(live.hicp)) hicp = { ...live.hicp, via: 'en-vivo' };
  else if (cache && validHicp(cache.hicp)) hicp = { ...cache.hicp, via: 'cache' };
  else if (wb && validHicp(wb.hicp)) hicp = { ...wb.hicp, via: 'en-vivo' };
  else hicp = { ...defaults.hicp, via: 'por-defecto' };

  const all = [...Object.values(sectors), hicp];
  const fuentes = [...new Set(all.map((x) => `${x.fuente}${x.via === 'cache' ? ' (caché)' : ''}`))];
  return {
    fuente: fuentes.join(' + '),
    fecha: new Date().toISOString().slice(0, 10),
    cacheFecha: cache?.generado || cache?.fecha || null,
    sectors,
    hicp,
    manufacturing: wb?.manufacturing || cache?.manufacturing || null,
  };
}

/**
 * Carga las métricas en el navegador.
 * @param {{fetchFn?:typeof fetch, cacheUrl:string, skipLive?:boolean}} o
 */
export async function loadMetrics(o) {
  const fetchFn = o.fetchFn || fetch.bind(globalThis);
  let live = null;
  let cache = null;
  let wb = null;
  if (!o.skipLive) {
    try {
      live = await fetchEurostat(fetchFn, NACE_BY_SECTOR);
    } catch {
      live = null;
    }
  }
  const complete = (m) => m && SECTOR_IDS.every((s) => validSector(m.sectors?.[s])) && validHicp(m.hicp);
  if (!complete(live)) {
    try {
      cache = await fetchJson(fetchFn, o.cacheUrl, 5000);
    } catch {
      cache = null;
    }
  }
  const hicpKnown = (live && validHicp(live.hicp)) || (cache && validHicp(cache.hicp));
  if (!hicpKnown && !o.skipLive) {
    try {
      wb = await fetchWorldBank(fetchFn);
    } catch {
      wb = null;
    }
  }
  return resolveMetrics({ live, cache, wb });
}

/** Convierte las métricas resueltas al formato que espera el motor. */
export function toEngineMetrics(m) {
  return {
    hicp: { rate: m.hicp.rate },
    sectors: Object.fromEntries(
      SECTOR_IDS.map((s) => [s, { index: m.sectors[s].index, sigma: m.sectors[s].sigma }]),
    ),
  };
}
