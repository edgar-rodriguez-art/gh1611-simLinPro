// @ts-check
// Comprador: vende al consumidor final (demanda Poisson) y repone pidiendo a los distribuidores.
import {
  SECTORS,
  SECTOR_IDS,
  BASKET_KEYS,
  RETAIL_MULT,
  HOLDING_RATE_DAY,
  refDistPrice,
} from '../../config.js';
import { distPrice, distributorReceiveOrder } from './distributor.js';

export const OPEN_HOURS = [8, 20]; // la tienda abre de 8 a 20 h
export const ORDER_HOUR = 7;

export function createBuyer(slotSector, params, cash) {
  /** @type {Record<string, number>} */
  const stock = {};
  /** @type {Record<string, number>} */
  const onOrder = {};
  for (const s of SECTOR_IDS) {
    stock[s] = Math.round(SECTORS[s].lambda * (params[BASKET_KEYS[s]] / 100) * 2);
    onOrder[s] = 0;
  }
  return {
    sector: slotSector,
    params,
    cash,
    stock,
    onOrder,
    lastOrderDay: -99,
    demandHist: Object.fromEntries(SECTOR_IDS.map((s) => [s, /** @type {number[]} */ ([])])),
    totalDemandHist: /** @type {number[]} */ ([]),
    ordersHist: /** @type {number[]} */ ([]),
    acc: newBuyerAcc(),
    negDays: 0,
    bankrupt: false,
  };
}

export function newBuyerAcc() {
  return {
    demand: 0,
    sold: 0,
    lost: 0,
    revenue: 0,
    costs: 0,
    ordered: 0,
    rejected: 0,
    invSum: 0,
    hours: 0,
    bySector: Object.fromEntries(SECTOR_IDS.map((s) => [s, 0])),
  };
}

export function retailPrice(engine, sector) {
  return SECTORS[sector].refCost * RETAIL_MULT * engine.state.priceIndex[sector];
}

/** Demanda diaria esperada de los consumidores de este comprador para un sector. */
export function buyerExpectedDemand(engine, b, sector) {
  return engine.lambda(sector) * (b.params[BASKET_KEYS[sector]] / 100);
}

export function buyerDailyEstimate(engine, b, sector) {
  const h = b.demandHist[sector];
  if (h.length >= 3) {
    const k = Math.min(7, h.length);
    let s = 0;
    for (let i = h.length - k; i < h.length; i++) s += h[i];
    // mezcla con la expectativa por si la cesta cambió
    return 0.5 * (s / k) + 0.5 * buyerExpectedDemand(engine, b, sector);
  }
  return buyerExpectedDemand(engine, b, sector);
}

export function buyerTick(engine, b) {
  const st = engine.state;
  const t = st.t;
  const h = t % 24;
  const day = Math.floor(t / 24);
  const par = b.params;
  const acc = b.acc;

  // Almacenaje
  let hold = 0;
  for (const s of SECTOR_IDS) hold += b.stock[s] * SECTORS[s].refCost * 1.5;
  const holdCost = (hold * HOLDING_RATE_DAY) / 24;
  b.cash -= holdCost;
  acc.costs += holdCost;

  // Ventas al consumidor final
  if (h >= OPEN_HOURS[0] && h < OPEN_HOURS[1]) {
    const hoursOpen = OPEN_HOURS[1] - OPEN_HOURS[0];
    for (const s of SECTOR_IDS) {
      const lam = buyerExpectedDemand(engine, b, s) / hoursOpen;
      if (lam <= 0) continue;
      const dmd = engine.rng.poisson(lam);
      const sold = Math.min(dmd, Math.floor(b.stock[s]));
      b.stock[s] -= sold;
      const rev = sold * retailPrice(engine, s);
      b.cash += rev;
      acc.revenue += rev;
      acc.demand += dmd;
      acc.sold += sold;
      acc.lost += dmd - sold;
      acc.bySector[s] += dmd;
      if (dmd > sold && b.stock[s] < 1)
        engine.emit('stockout', { sector: s, buyer: b.sector, lost: dmd - sold });
    }
  }

  // Pedidos a los distribuidores
  if (h === ORDER_HOUR && day - b.lastOrderDay >= par.orderEvery) {
    b.lastOrderDay = day;
    const isBot = st.slots[`buyer-${b.sector}`].controller === 'bot';
    for (const s of SECTOR_IDS) {
      if (par[BASKET_KEYS[s]] <= 0) continue;
      // El BOT usa la demanda base; el humano, la media observada de 7 días
      const base = isBot ? buyerExpectedDemand(engine, b, s) : buyerDailyEstimate(engine, b, s);
      const est = base * (par.demandPct / 100);
      const target = est * (par.orderEvery + par.safetyDays + 1);
      const qty = Math.ceil(target - b.stock[s] - b.onOrder[s]);
      if (qty <= 0) continue;
      const d = st.distributors[s];
      const price = distPrice(engine, d);
      const maxPrice = refDistPrice(s) * (par.maxPricePct / 100) * st.priceIndex[s];
      if (price > maxPrice) {
        acc.rejected += 1;
        engine.emit('price_rejected', { sector: s, buyer: b.sector, price, maxPrice });
        continue;
      }
      b.onOrder[s] += qty;
      acc.ordered += qty;
      distributorReceiveOrder(engine, d, b.sector, qty, price);
    }
  }

  let inv = 0;
  for (const s of SECTOR_IDS) inv += b.stock[s];
  acc.invSum += inv;
  acc.hours += 1;
}
