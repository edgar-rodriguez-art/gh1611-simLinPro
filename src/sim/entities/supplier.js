// @ts-check
// Proveedores BOT: precio, plazo y calidad ligados a las métricas de España.
import { SECTORS, SUPPLIERS } from '../../config.js';

/** Costo del insumo por unidad de producto (50 % del costo de referencia) con deriva IPCA. */
export function inputUnitPrice(engine, sector, supplierKey) {
  const base = SECTORS[sector].refCost * 0.5 * SUPPLIERS[supplierKey].priceFactor;
  return base * engine.state.priceIndex[sector];
}

/** Plazo de entrega en horas (lognormal). */
export function sampleLeadHours(engine, supplierKey) {
  const sup = SUPPLIERS[supplierKey];
  return Math.max(4, engine.rng.lognormal(sup.leadDays * 24, sup.sigma));
}

/**
 * Actualiza el índice de precio de insumos: cada 30 días simulados se aplica IPCA/12,
 * repartido por hora, más ruido proporcional a la volatilidad del índice sectorial.
 */
export function updatePriceIndex(engine) {
  const st = engine.state;
  const monthly = st.metrics.hicp.rate / 100 / 12;
  for (const s of /** @type {const} */ (['bakery', 'textile', 'electronics'])) {
    const hourly = monthly / (30 * 24);
    const noise = engine.rng.normal() * (st.metrics.sectors[s].sigma * 0.02);
    st.priceIndex[s] = Math.max(0.5, st.priceIndex[s] * (1 + hourly) * (1 + noise / 24));
  }
}
