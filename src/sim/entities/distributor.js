// @ts-check
// Distribuidor: compra al productor, almacena y entrega al comprador con su flota.
import { SECTORS, SECTOR_IDS, TRUCK_DAY_COST, TRUCK_TRIP_COST, HOLDING_RATE_DAY } from '../../config.js';
import { producerReceiveOrder } from './producer.js';

export const ROUTE_HOURS = { 1: [10], 2: [8, 15], 3: [7, 12, 17], 4: [6, 10, 14, 18] };
export const OTIF_HOURS = 48;

export function createDistributor(sector, params, cash) {
  const d = {
    sector,
    params,
    cash,
    stock: Math.round(SECTORS[sector].lambda * 3),
    onOrder: 0,
    queue: /** @type {{id:number, buyer:string, qty:number, remaining:number, placedAt:number, price:number}[]} */ ([]),
    trucks: /** @type {any[]} */ ([]),
    ordersHist: /** @type {number[]} */ ([]), // unidades pedidas por compradores por día
    toProducerHist: /** @type {number[]} */ ([]), // unidades pedidas al productor por día
    leadTimes: /** @type {number[]} */ ([]), // horas pedido→entrega (últimos 200)
    acc: newDistAcc(),
    negDays: 0,
    bankrupt: false,
  };
  syncTrucks(d);
  return d;
}

export function newDistAcc() {
  return {
    ordered: 0,
    delivered: 0,
    ordersDone: 0,
    ordersOtif: 0,
    revenue: 0,
    costs: 0,
    purchased: 0,
    toProducer: 0,
    truckBusyH: 0,
    truckH: 0,
    trips: 0,
    invSum: 0,
    hours: 0,
  };
}

/** Ajusta el número de camiones al parámetro (los que están en ruta terminan su viaje). */
export function syncTrucks(d) {
  const n = d.params.trucks;
  while (d.trucks.length < n) d.trucks.push({ id: d.trucks.length, status: 'idle', retire: false });
  d.trucks.forEach((tr, i) => (tr.retire = i >= n));
  d.trucks = d.trucks.filter((tr, i) => i < n || tr.status !== 'idle');
}

export function distPrice(engine, d) {
  return engine.state.producers[d.sector].params.price * (1 + d.params.margin / 100);
}

export function distDailyDemand(engine, d) {
  const h = d.ordersHist;
  if (h.length >= 3) {
    const k = Math.min(7, h.length);
    let s = 0;
    for (let i = h.length - k; i < h.length; i++) s += h[i];
    return Math.max(1, s / k);
  }
  return engine.lambda(d.sector);
}

/** Factor de distancia del centro logístico a la tienda de cada carril. */
export function laneFactor(buyerSector) {
  return 1 + Math.abs(SECTOR_IDS.indexOf(buyerSector) - 1) * 0.3;
}

export function distributorTick(engine, d) {
  const st = engine.state;
  const t = st.t;
  const h = t % 24;
  const sec = SECTORS[d.sector];
  const par = d.params;
  const acc = d.acc;

  // Costos: flota (por día, escalado por capacidad) y almacenaje
  const capScale = Math.pow(par.truckCap / sec.truckCap.def, 0.7);
  let cost = (TRUCK_DAY_COST[d.sector] * capScale * d.trucks.length) / 24;
  cost += (d.stock * sec.refCost * 1.25 * HOLDING_RATE_DAY) / 24;
  d.cash -= cost;
  acc.costs += cost;

  // Camiones: llegada y regreso
  for (const tr of d.trucks) {
    acc.truckH += 1;
    if (tr.status === 'out') {
      acc.truckBusyH += 1;
      if (t >= tr.arriveAt) deliver(engine, d, tr);
    } else if (tr.status === 'return') {
      acc.truckBusyH += 1;
      if (t >= tr.returnAt) {
        tr.status = 'idle';
        engine.emit('truck_return', { sector: d.sector, truck: tr.id });
      }
    }
  }
  d.trucks = d.trucks.filter((tr) => !(tr.retire && tr.status === 'idle'));

  // Política (s, Q) en días de demanda
  const daily = distDailyDemand(engine, d);
  const backlogUnits = d.queue.reduce((a, o) => a + o.remaining, 0);
  const position = d.stock + d.onOrder - backlogUnits;
  if (position < par.s * daily || (par.s === 0 && position <= 0 && backlogUnits > 0)) {
    const qty = Math.max(1, Math.ceil(par.Q * daily));
    d.onOrder += qty;
    acc.toProducer += qty;
    engine.emit('dist_order', { sector: d.sector, qty });
    producerReceiveOrder(engine, st.producers[d.sector], qty);
  }

  // Salidas de ruta
  const isRoute = ROUTE_HOURS[par.routesPerDay].includes(h);
  const isBot = st.slots[`distributor-${d.sector}`].controller === 'bot';
  if (isRoute || isBot) dispatch(engine, d, isRoute, isBot);

  acc.invSum += d.stock;
  acc.hours += 1;
}

function dispatch(engine, d, isRoute, isBot) {
  const t = engine.state.t;
  const cap = d.params.truckCap;
  for (const tr of d.trucks) {
    if (tr.status !== 'idle' || tr.retire) continue;
    if (d.stock < 1) return;
    const first = d.queue.find((o) => o.remaining > 0);
    if (!first) return;
    // Unidades que caben para el comprador del primer pedido
    let loadable = 0;
    for (const o of d.queue) if (o.buyer === first.buyer) loadable += o.remaining;
    loadable = Math.min(loadable, cap, Math.floor(d.stock));
    if (loadable < 1) return;
    if (isBot) {
      // BOT: sale si llena el 80 % o si el pedido más antiguo vence (12 h)
      const due = t - first.placedAt >= 12;
      if (!(loadable >= 0.8 * cap || (isRoute && due) || t - first.placedAt >= 24)) return;
    }
    const load = [];
    let left = loadable;
    for (const o of d.queue) {
      if (left <= 0) break;
      if (o.buyer !== first.buyer) continue;
      const q = Math.min(o.remaining, left);
      if (q <= 0) continue;
      load.push({ id: o.id, qty: q });
      o.remaining -= q;
      left -= q;
    }
    const qty = loadable - left;
    d.stock -= qty;
    const [a, b, c] = SECTORS[d.sector].tripHours;
    const travel = engine.rng.triangular(a, b, c) * laneFactor(first.buyer);
    tr.status = 'out';
    tr.load = load;
    tr.qty = qty;
    tr.dest = first.buyer;
    tr.departAt = t;
    tr.arriveAt = t + travel;
    tr.returnAt = t + travel * 2;
    d.cash -= TRUCK_TRIP_COST[d.sector];
    d.acc.costs += TRUCK_TRIP_COST[d.sector];
    d.acc.trips += 1;
    engine.emit('truck_depart', {
      sector: d.sector,
      truck: tr.id,
      qty,
      dest: first.buyer,
      departAt: tr.departAt,
      arriveAt: tr.arriveAt,
      returnAt: tr.returnAt,
    });
  }
}

function deliver(engine, d, tr) {
  const st = engine.state;
  const buyer = st.buyers[tr.dest];
  const t = st.t;
  let amount = 0;
  for (const l of tr.load) {
    const o = d.queue.find((x) => x.id === l.id);
    const price = o ? o.price : distPrice(engine, d);
    amount += l.qty * price;
    buyer.stock[d.sector] += l.qty;
    buyer.onOrder[d.sector] -= l.qty;
    d.acc.delivered += l.qty;
    if (o) {
      o.delivered = (o.delivered || 0) + l.qty;
      if (o.delivered >= o.qty) {
        const lt = t - o.placedAt;
        d.leadTimes.push(lt);
        if (d.leadTimes.length > 200) d.leadTimes.shift();
        d.acc.ordersDone += 1;
        if (lt <= OTIF_HOURS) d.acc.ordersOtif += 1;
        const idx = d.queue.indexOf(o);
        if (idx >= 0) d.queue.splice(idx, 1);
      }
    }
  }
  buyer.cash -= amount;
  buyer.acc.costs += amount;
  d.cash += amount;
  d.acc.revenue += amount;
  tr.status = 'return';
  tr.load = [];
  engine.emit('truck_arrive', { sector: d.sector, truck: tr.id, dest: tr.dest, qty: tr.qty });
  engine.emit('payment', { sector: d.sector, from: 'buyer', to: 'distributor', amount, buyer: tr.dest });
}

/** Pedido del comprador al distribuidor. */
export function distributorReceiveOrder(engine, d, buyerSector, qty, price) {
  const st = engine.state;
  const id = ++st.orderSeq;
  d.queue.push({ id, buyer: buyerSector, qty, remaining: qty, placedAt: st.t, price, delivered: 0 });
  d.acc.ordered += qty;
  engine.emit('buyer_order', { sector: d.sector, buyer: buyerSector, qty });
}
