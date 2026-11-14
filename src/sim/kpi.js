// @ts-check
// Cálculo de KPI (funciones puras). El motor acumula contadores y estas funciones los convierten en KPI.

export function safeDiv(a, b, fallback = 0) {
  return b > 0 ? a / b : fallback;
}

/** OEE = disponibilidad × rendimiento × calidad. */
export function oee(availability, performance, quality) {
  return availability * performance * quality;
}

export function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (const x of arr) s += x;
  return s / arr.length;
}

export function variance(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let s = 0;
  for (const x of arr) s += (x - m) * (x - m);
  return s / (arr.length - 1);
}

/** Percentil con interpolación lineal (p en [0, 100]). */
export function percentile(arr, p) {
  if (!arr.length) return 0;
  const a = Float64Array.from(arr).sort();
  if (a.length === 1) return a[0];
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

/** Efecto látigo = varianza de pedidos / varianza de demanda. */
export function bullwhip(orders, demand) {
  const vd = variance(demand);
  return vd > 0 ? variance(orders) / vd : 0;
}

/** Fill rate = unidades servidas / unidades pedidas. */
export function fillRate(served, requested) {
  return safeDiv(served, requested, 1);
}

/**
 * KPI del productor a partir de acumuladores.
 * @param {{plannedH:number, runH:number, produced:number, good:number, idealRate:number,
 *          shipped:number, requested:number, revenue:number, costs:number}} acc
 */
export function producerKpi(acc) {
  const availability = safeDiv(acc.runH, acc.plannedH, 0);
  const performance = Math.min(1, safeDiv(acc.produced, acc.runH * acc.idealRate, 0));
  const quality = safeDiv(acc.good, acc.produced, 1);
  return {
    availability,
    performance,
    quality,
    oee: oee(availability, performance, quality),
    fillRate: fillRate(acc.shipped, acc.requested),
    unitCost: safeDiv(acc.costs, acc.good, 0),
    revenue: acc.revenue,
    margin: acc.revenue - acc.costs,
  };
}

/** Días de cobertura = inventario / demanda diaria media. */
export function coverageDays(stock, dailyDemand) {
  return dailyDemand > 0 ? stock / dailyDemand : stock > 0 ? 99 : 0;
}
