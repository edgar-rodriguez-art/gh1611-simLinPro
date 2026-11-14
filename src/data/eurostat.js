// @ts-check
// Funciones puras para leer Eurostat (JSON-stat 2.0) y Banco Mundial. Las usan el navegador y el script de Node.

export const EUROSTAT_BASE = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/';
export const WORLDBANK_BASE = 'https://api.worldbank.org/v2/country/ESP/indicator/';
export const S_ADJ_ORDER = ['SCA', 'CA', 'NSA'];

export function eurostatUrl(dataset, filters) {
  const q = new URLSearchParams({ ...filters, lastTimePeriod: '24' });
  return EUROSTAT_BASE + dataset + '?' + q.toString();
}

export function productionUrl(nace, sAdj) {
  return eurostatUrl('sts_inpr_m', { geo: 'ES', unit: 'I21', nace_r2: nace, s_adj: sAdj });
}

export function hicpUrl() {
  return eurostatUrl('prc_hicp_manr', { geo: 'ES', coicop: 'CP00' });
}

export function worldBankUrl(indicator) {
  return WORLDBANK_BASE + indicator + '?format=json&mrv=5';
}

/**
 * Convierte un dataset JSON-stat 2.0 (con todas las dimensiones fijadas salvo el tiempo) en una serie ordenada.
 * Admite `value` como objeto disperso o como array.
 * @returns {{period:string, value:number}[]}
 */
export function parseJsonStatSeries(json) {
  if (!json || typeof json !== 'object' || !json.dimension || !json.id || !json.size) {
    throw new Error('JSON-stat no válido');
  }
  const ids = json.id;
  const sizes = json.size;
  const timeDim = ids.includes('time') ? 'time' : ids[ids.length - 1];
  const tPos = ids.indexOf(timeDim);
  // stride de la dimensión tiempo (orden fila-mayor)
  let stride = 1;
  for (let i = ids.length - 1; i > tPos; i--) stride *= sizes[i];
  const idx = json.dimension[timeDim].category.index;
  const entries = Array.isArray(idx) ? idx.map((p, i) => [p, i]) : Object.entries(idx);
  const out = [];
  for (const [period, i] of entries) {
    const flat = /** @type {number} */ (i) * stride;
    const v = Array.isArray(json.value) ? json.value[flat] : json.value[String(flat)];
    if (typeof v === 'number' && Number.isFinite(v)) out.push({ period, value: v });
  }
  out.sort((a, b) => (a.period < b.period ? -1 : 1));
  return out;
}

/** Desviación típica (muestral) de las variaciones mensuales relativas. */
export function monthlyVolatility(series) {
  const ch = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value;
    if (prev) ch.push(series[i].value / prev - 1);
  }
  if (ch.length < 2) return 0;
  const m = ch.reduce((a, b) => a + b, 0) / ch.length;
  const v = ch.reduce((a, b) => a + (b - m) ** 2, 0) / (ch.length - 1);
  return Math.sqrt(v);
}

/** Índice y volatilidad de un sector a partir de la serie de producción industrial. */
export function sectorFromSeries(series, meta) {
  if (!series.length) throw new Error('serie vacía');
  const last = series[series.length - 1];
  return {
    index: Math.round(last.value * 10) / 10,
    sigma: Math.round(monthlyVolatility(series) * 10000) / 10000,
    period: last.period,
    n: series.length,
    ...meta,
  };
}

/** ¿El periodo (AAAA-MM) tiene más de `months` meses respecto a `today`? */
export function isStale(period, today = new Date(), months = 6) {
  const m = /^(\d{4})-(\d{2})/.exec(String(period || ''));
  if (!m) return true;
  const diff = (today.getUTCFullYear() - Number(m[1])) * 12 + (today.getUTCMonth() + 1 - Number(m[2]));
  return diff > months;
}

/** Lee la respuesta del Banco Mundial: [meta, [{date, value}]] → último valor no nulo. */
export function parseWorldBank(json) {
  if (!Array.isArray(json) || !Array.isArray(json[1])) throw new Error('respuesta del Banco Mundial no válida');
  const rows = json[1].filter((r) => r && typeof r.value === 'number').sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!rows.length) throw new Error('sin datos');
  return { value: rows[0].value, period: String(rows[0].date) };
}

/** fetch con tiempo de espera. */
export async function fetchJson(fetchFn, url, timeoutMs = 8000) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const to = setTimeout(() => ctrl && ctrl.abort(), timeoutMs);
  try {
    const r = await fetchFn(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(to);
  }
}

/**
 * Descarga en vivo de Eurostat (un nace_r2 por petición, probando SCA → CA → NSA) y la inflación IPCA.
 * Devuelve los elementos que se pudieron obtener; los que fallan quedan en `errors`.
 */
export async function fetchEurostat(fetchFn, naceBySector, today = new Date()) {
  /** @type {Record<string, any>} */
  const sectors = {};
  const errors = [];
  const fecha = today.toISOString().slice(0, 10);
  for (const [sector, nace] of Object.entries(naceBySector)) {
    let done = false;
    for (const sAdj of S_ADJ_ORDER) {
      try {
        const series = parseJsonStatSeries(await fetchJson(fetchFn, productionUrl(nace, sAdj)));
        if (series.length < 3) throw new Error('serie corta');
        sectors[sector] = sectorFromSeries(series, { fuente: 'eurostat', dataset: 'sts_inpr_m', nace, s_adj: sAdj, fecha });
        done = true;
        break;
      } catch (e) {
        errors.push(`${nace}/${sAdj}: ${e && e.message ? e.message : e}`);
      }
    }
    if (!done) errors.push(`${nace}: sin datos`);
  }
  let hicp = null;
  try {
    const s = parseJsonStatSeries(await fetchJson(fetchFn, hicpUrl()));
    const last = s[s.length - 1];
    hicp = {
      rate: last.value,
      period: last.period,
      fuente: 'eurostat',
      dataset: 'prc_hicp_manr',
      fecha,
      stale: isStale(last.period, today),
    };
  } catch (e) {
    errors.push(`prc_hicp_manr: ${e && e.message ? e.message : e}`);
  }
  return { sectors, hicp, errors };
}

/** Respaldo anual del Banco Mundial (IPC % y manufactura % del PIB). */
export async function fetchWorldBank(fetchFn, today = new Date()) {
  const fecha = today.toISOString().slice(0, 10);
  const cpi = parseWorldBank(await fetchJson(fetchFn, worldBankUrl('FP.CPI.TOTL.ZG')));
  let manuf = null;
  try {
    manuf = parseWorldBank(await fetchJson(fetchFn, worldBankUrl('NV.IND.MANF.ZS')));
  } catch {
    /* opcional */
  }
  return {
    hicp: { rate: Math.round(cpi.value * 100) / 100, period: cpi.period, fuente: 'banco-mundial', indicador: 'FP.CPI.TOTL.ZG', fecha },
    manufacturing: manuf ? { value: manuf.value, period: manuf.period, fuente: 'banco-mundial', indicador: 'NV.IND.MANF.ZS' } : null,
  };
}
