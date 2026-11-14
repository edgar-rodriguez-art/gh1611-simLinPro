#!/usr/bin/env node
// Descarga Eurostat (y Banco Mundial como respaldo) y escribe data/metrics.json.
// Uso: node scripts/fetch-metrics.mjs [--fixtures tests/fixtures] [--out data/metrics.json]
// Si no hay red, conserva la caché existente y termina sin error (la Action no hace commit).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchEurostat, fetchWorldBank } from '../src/data/eurostat.js';
import { NACE_BY_SECTOR, resolveMetrics } from '../src/data/metrics.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const out = path.resolve(root, opt('--out') || 'data/metrics.json');
const fixtures = opt('--fixtures');

/** fetch que sirve ficheros locales según la URL (para pruebas sin red). */
function fixtureFetch(dir) {
  const map = (url) => {
    if (url.includes('prc_hicp_manr')) return 'eurostat-hicp.json';
    const nace = /nace_r2=(C\d+)/.exec(url);
    if (nace) return `eurostat-${nace[1]}.json`;
    if (url.includes('FP.CPI.TOTL.ZG')) return 'worldbank-cpi.json';
    if (url.includes('NV.IND.MANF.ZS')) return 'worldbank-manuf.json';
    return null;
  };
  return async (url) => {
    const f = map(url);
    if (!f) return { ok: false, status: 404, json: async () => ({}) };
    const txt = await readFile(path.resolve(root, dir, f), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(txt) };
  };
}

async function main() {
  const fetchFn = fixtures ? fixtureFetch(fixtures) : fetch;
  let cache;
  try {
    cache = JSON.parse(await readFile(out, 'utf8'));
  } catch {
    cache = null;
  }
  const live = await fetchEurostat(fetchFn, NACE_BY_SECTOR);
  for (const e of live.errors) console.warn('Aviso Eurostat:', e);
  if (live.hicp?.stale) {
    console.warn(
      'Aviso: prc_hicp_manr tiene más de 6 meses. Busca el dataset sucesor y documéntalo en CLAUDE.md §6.',
    );
  }
  let wb = null;
  try {
    wb = await fetchWorldBank(fetchFn);
  } catch (e) {
    console.warn('Aviso Banco Mundial:', e.message);
  }
  const liveCount = Object.keys(live.sectors).length + (live.hicp ? 1 : 0);
  if (liveCount === 0 && !wb && cache) {
    console.log('Sin red hacia Eurostat ni Banco Mundial: se conserva la caché existente.');
    return;
  }
  const resolved = resolveMetrics({ live, cache, wb });
  const data = {
    schema: 1,
    generado: new Date().toISOString(),
    fuente: resolved.fuente,
    sectors: Object.fromEntries(Object.entries(resolved.sectors).map(([k, v]) => [k, stripVia(v)])),
    hicp: stripVia(resolved.hicp),
    manufacturing: resolved.manufacturing,
  };
  // No reescribe si solo cambia la marca de tiempo
  if (cache && JSON.stringify({ ...cache, generado: 0 }) === JSON.stringify({ ...data, generado: 0 })) {
    console.log('Métricas sin cambios.');
    return;
  }
  await writeFile(out, JSON.stringify(data, null, 2) + '\n');
  console.log('Escrito', path.relative(root, out), '·', data.fuente);
}

function stripVia(x) {
  const { via: _via, ...rest } = x;
  return rest;
}

main().catch((e) => {
  console.error('Error al actualizar métricas:', e);
  process.exit(1);
});
