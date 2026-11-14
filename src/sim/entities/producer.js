// @ts-check
// Productor: compra insumos al proveedor BOT, fabrica por lotes y vende al distribuidor.
import { SECTORS, SUPPLIERS, INSPECTION, SETUP_HOURS, HOLDING_RATE_DAY, RETURN_PENALTY, SHIFT_HOURS } from '../../config.js';
import { inputUnitPrice, sampleLeadHours } from './supplier.js';

export function createProducer(sector, params, cash) {
  const sec = SECTORS[sector];
  const daily = sec.lambda;
  return {
    sector,
    params,
    cash,
    inputStock: Math.round(daily * 3),
    fgStock: Math.round(daily * 2),
    onOrderInput: 0,
    inputOrders: /** @type {{qty:number, arriveAt:number, unitPrice:number, supplier:string}[]} */ ([]),
    machine: { status: 'idle', ttf: 0, repairUntil: 0 },
    lot: /** @type {null | {size:number, done:number, setupLeft:number}} */ (null),
    backlog: 0,
    outbound: /** @type {{qty:number, arriveAt:number, price:number}[]} */ ([]),
    ordersHist: /** @type {number[]} */ ([]), // pedidos diarios recibidos del distribuidor
    inputOrdersHist: /** @type {number[]} */ ([]), // pedidos diarios de insumo
    acc: newAcc(),
    negDays: 0,
    bankrupt: false,
  };
}

export function newAcc() {
  return {
    plannedH: 0,
    runH: 0,
    downH: 0,
    produced: 0,
    good: 0,
    defects: 0,
    idealUnits: 0,
    actualUnits: 0,
    shipped: 0,
    shippedNow: 0,
    requested: 0,
    revenue: 0,
    costs: 0,
    ordersIn: 0,
    inputOrdered: 0,
    invSum: 0,
    hours: 0,
  };
}

/** ¿La hora h (0-23) está dentro de algún turno? Turno 1: 6-14, 2: 14-22, 3: 22-6. */
export function inShift(h, shifts) {
  if (shifts >= 3) return true;
  if (shifts === 2) return h >= 6 && h < 22;
  return h >= 6 && h < 6 + SHIFT_HOURS;
}

export function mtbfFor(sector, maintenance) {
  return SECTORS[sector].mtbfHours * (1 + maintenance * 0.25);
}

/** Demanda diaria estimada (media de 7 días de pedidos o λ ajustado). */
export function producerDailyDemand(engine, p) {
  const h = p.ordersHist;
  if (h.length >= 3) {
    const k = Math.min(7, h.length);
    let s = 0;
    for (let i = h.length - k; i < h.length; i++) s += h[i];
    return Math.max(1, s / k);
  }
  return engine.lambda(p.sector);
}

export function producerTick(engine, p) {
  const st = engine.state;
  const t = st.t;
  const h = t % 24;
  const sec = SECTORS[p.sector];
  const par = p.params;
  const insp = INSPECTION[par.inspection];
  const m = par.maintenance / 100;
  const acc = p.acc;

  // Costos fijos por hora: gastos generales 24 h, mano de obra solo en turno.
  const overhead = (0.15 * sec.refCost * sec.ratePerHour * 16) / 24;
  let cost = overhead;
  const working = inShift(h, par.shifts);
  if (working) cost += 0.3 * sec.refCost * sec.ratePerHour;
  // Almacenaje
  const inPrice = inputUnitPrice(engine, p.sector, par.supplier);
  cost += ((p.fgStock * sec.refCost + p.inputStock * inPrice) * HOLDING_RATE_DAY) / 24;
  p.cash -= cost;
  acc.costs += cost;

  // Llegadas de insumos
  for (let i = p.inputOrders.length - 1; i >= 0; i--) {
    const o = p.inputOrders[i];
    if (o.arriveAt <= t) {
      p.inputOrders.splice(i, 1);
      p.inputStock += o.qty;
      p.onOrderInput -= o.qty;
      const amount = o.qty * o.unitPrice;
      p.cash -= amount;
      acc.costs += amount;
      engine.emit('input_delivery', { sector: p.sector, qty: o.qty, supplier: o.supplier });
      engine.emit('payment', { sector: p.sector, from: 'producer', to: 'supplier', amount });
    }
  }

  // Máquina
  const mc = p.machine;
  if (mc.status === 'down') {
    if (t >= mc.repairUntil) {
      mc.status = 'idle';
      mc.ttf = engine.rng.exponential(mtbfFor(p.sector, par.maintenance));
      engine.emit('repair', { sector: p.sector });
    } else if (working) {
      acc.plannedH += 1 - m;
      acc.downH += 1 - m;
    }
  } else if (working) {
    const avail = 1 - m;
    acc.plannedH += avail;
    const daily = producerDailyDemand(engine, p);
    const fgCap = daily * 5;
    if (!p.lot && p.fgStock < fgCap && p.inputStock >= par.lotSize) {
      p.inputStock -= par.lotSize;
      p.lot = { size: par.lotSize, done: 0, setupLeft: SETUP_HOURS };
      engine.emit('lot_start', { sector: p.sector, size: par.lotSize });
    }
    if (p.lot) {
      let hrs = avail;
      if (p.lot.setupLeft > 0) {
        const s = Math.min(hrs, p.lot.setupLeft);
        p.lot.setupLeft -= s;
        hrs -= s;
      }
      if (hrs > 0) {
        mc.status = 'run';
        const rate = sec.ratePerHour * (1 - insp.slowdown);
        const units = rate * hrs;
        acc.runH += hrs;
        acc.idealUnits += sec.ratePerHour * hrs;
        acc.actualUnits += units;
        p.lot.done += units;
        mc.ttf -= hrs;
        if (p.lot.done >= p.lot.size) finishLot(engine, p);
        if (mc.ttf <= 0) {
          mc.status = 'down';
          mc.repairUntil = t + engine.rng.triangular(2, 4, 10);
          engine.emit('breakdown', { sector: p.sector, until: mc.repairUntil });
        }
      } else {
        mc.status = 'run';
      }
    } else {
      mc.status = 'idle';
    }
  } else if (mc.status !== 'down') {
    mc.status = 'off';
  }

  // Reorden de insumos (punto de reorden en días de cobertura)
  const daily = producerDailyDemand(engine, p);
  const position = p.inputStock + p.onOrderInput;
  if (position < par.reorderDays * daily) {
    const qty = Math.max(par.lotSize, Math.ceil((par.reorderDays + 3) * daily - position));
    const lead = sampleLeadHours(engine, par.supplier);
    p.inputOrders.push({ qty, arriveAt: t + Math.round(lead), unitPrice: inPrice, supplier: par.supplier });
    p.onOrderInput += qty;
    acc.inputOrdered += qty;
    engine.emit('input_order', { sector: p.sector, qty, supplier: par.supplier });
  }

  // Envíos al distribuidor desde el pedido pendiente
  if (p.backlog > 0 && p.fgStock > 0) {
    const q = Math.min(p.backlog, Math.floor(p.fgStock));
    if (q > 0) shipToDistributor(engine, p, q);
  }

  // Llegada de lotes al distribuidor (cobro)
  for (let i = p.outbound.length - 1; i >= 0; i--) {
    const o = p.outbound[i];
    if (o.arriveAt <= t) {
      p.outbound.splice(i, 1);
      const d = st.distributors[p.sector];
      d.stock += o.qty;
      d.onOrder -= o.qty;
      const amount = o.qty * o.price;
      d.cash -= amount;
      d.acc.costs += amount;
      d.acc.purchased += o.qty;
      p.cash += amount;
      acc.revenue += amount;
      engine.emit('dist_receive', { sector: p.sector, qty: o.qty });
      engine.emit('payment', { sector: p.sector, from: 'distributor', to: 'producer', amount });
    }
  }

  acc.invSum += p.fgStock;
  acc.hours += 1;
}

function finishLot(engine, p) {
  const par = p.params;
  const sec = SECTORS[p.sector];
  const insp = INSPECTION[par.inspection];
  const lot = /** @type {{size:number}} */ (p.lot);
  const pDef = Math.min(
    0.5,
    (sec.baseDefect + SUPPLIERS[par.supplier].defectAdd) * insp.defectMult * (1 - (par.maintenance / 100) * 2),
  );
  const defects = engine.rng.binomial(lot.size, pDef);
  const caught = engine.rng.binomial(defects, insp.catchRate);
  const escaped = defects - caught;
  const good = lot.size - caught;
  p.fgStock += good;
  p.acc.produced += lot.size;
  p.acc.good += lot.size - defects;
  p.acc.defects += defects;
  // Los defectos no detectados generan devoluciones (penalización)
  if (escaped > 0) {
    const pen = escaped * par.price * RETURN_PENALTY;
    p.cash -= pen;
    p.acc.costs += pen;
  }
  p.lot = null;
  engine.emit('lot_done', { sector: p.sector, size: lot.size, good, defects });
}

export function shipToDistributor(engine, p, qty) {
  const sec = SECTORS[p.sector];
  p.fgStock -= qty;
  p.backlog -= qty;
  p.acc.shipped += qty;
  const [a, b, c] = sec.tripHours;
  const travel = engine.rng.triangular(a * 0.5, b * 0.5, c * 0.5);
  p.outbound.push({ qty, arriveAt: engine.state.t + Math.max(1, Math.round(travel)), price: p.params.price });
  engine.emit('ship_to_dist', { sector: p.sector, qty });
}

/** El distribuidor hace un pedido al productor. */
export function producerReceiveOrder(engine, p, qty) {
  p.acc.requested += qty;
  p.acc.ordersIn += qty;
  p.backlog += qty;
  const now = Math.min(qty, Math.floor(p.fgStock));
  p.acc.shippedNow += now;
  if (now > 0) shipToDistributor(engine, p, now);
}
