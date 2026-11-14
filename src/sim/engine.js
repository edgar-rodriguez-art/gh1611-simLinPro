// @ts-check
// Motor de simulación autoritativo. Paso interno: 1 hora simulada (tick).
// Determinista: semilla + configuración + secuencia de cambios = misma partida.
import {
  SECTOR_IDS,
  SECTORS,
  ALL_SLOTS,
  DEFAULT_METRICS,
  DEFAULT_DAYS,
  BANKRUPTCY_DAYS,
  defaultParams,
  clampParams,
  parseSlot,
} from '../config.js';
import { Rng } from './rng.js';
import { createProducer, producerTick, newAcc, mtbfFor } from './entities/producer.js';
import {
  createDistributor,
  distributorTick,
  newDistAcc,
  syncTrucks,
  distPrice,
} from './entities/distributor.js';
import { createBuyer, buyerTick, newBuyerAcc } from './entities/buyer.js';
import { updatePriceIndex } from './entities/supplier.js';
import { runBotsDaily } from './bots.js';
import { producerKpi, safeDiv, percentile, bullwhip, coverageDays } from './kpi.js';

/** Caja inicial por rol: días de facturación de referencia. */
function initialCash(role, sector) {
  const sec = SECTORS[sector];
  const dayValue = sec.lambda * sec.refCost;
  return Math.round(dayValue * (role === 'producer' ? 12 : role === 'distributor' ? 10 : 8));
}

export class Engine {
  /**
   * @param {{seed:number, days?:number, metrics?:any, controllers?:Record<string,'bot'|'human'>}} cfg
   */
  static create(cfg) {
    const metrics = cfg.metrics || DEFAULT_METRICS;
    const seed = cfg.seed >>> 0;
    /** @type {any} */
    const state = {
      version: 1,
      t: 0,
      seed,
      rngState: seed,
      days: cfg.days || DEFAULT_DAYS,
      metrics: {
        hicp: { rate: metrics.hicp.rate },
        sectors: Object.fromEntries(
          SECTOR_IDS.map((s) => [s, { index: metrics.sectors[s].index, sigma: metrics.sectors[s].sigma }]),
        ),
      },
      priceIndex: { bakery: 1, textile: 1, electronics: 1 },
      producers: {},
      distributors: {},
      buyers: {},
      slots: {},
      orderSeq: 0,
      paramLog: [],
      controlLog: [],
      kpiDaily: [],
      over: false,
    };
    for (const s of SECTOR_IDS) {
      state.producers[s] = createProducer(s, defaultParams('producer', s), initialCash('producer', s));
      state.distributors[s] = createDistributor(
        s,
        defaultParams('distributor', s),
        initialCash('distributor', s),
      );
      state.buyers[s] = createBuyer(s, defaultParams('buyer', s), initialCash('buyer', s));
    }
    for (const slot of ALL_SLOTS) {
      state.slots[slot] = { controller: cfg.controllers?.[slot] || 'bot', conservative: false };
    }
    const eng = new Engine(state);
    // Tiempo hasta la primera avería
    for (const s of SECTOR_IDS) {
      const p = state.producers[s];
      p.machine.ttf = eng.rng.exponential(mtbfFor(s, p.params.maintenance));
    }
    eng.state.rngState = eng.rng.state;
    return eng;
  }

  /** Reconstruye un motor desde un estado serializado (copia profunda). */
  static fromState(state, opts = {}) {
    const st =
      typeof structuredClone === 'function' ? structuredClone(state) : JSON.parse(JSON.stringify(state));
    const eng = new Engine(st);
    if (opts.seed !== undefined) eng.rng.state = opts.seed >>> 0;
    return eng;
  }

  constructor(state) {
    this.state = state;
    this.rng = new Rng(state.rngState);
    /** @type {any[]} */
    this.events = [];
    this.emitEvents = false;
    this.recordKpi = true;
    /** @type {null | ((day:number)=>void)} */
    this.onDayEnd = null;
  }

  emit(type, data) {
    if (this.emitEvents) this.events.push({ type, t: this.state.t, ...data });
  }

  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  lambda(sector) {
    return SECTORS[sector].lambda * (this.state.metrics.sectors[sector].index / 100);
  }

  get day() {
    return Math.floor(this.state.t / 24);
  }

  entityOf(slot) {
    const p = parseSlot(slot);
    if (!p) return null;
    const map = { producer: 'producers', distributor: 'distributors', buyer: 'buyers' };
    return this.state[map[p.role]][p.sector];
  }

  getParams(slot) {
    return { ...this.entityOf(slot).params };
  }

  /**
   * Aplica cambios de parámetros con *clamp*. Registra cada cambio en paramLog.
   * @param {string} slot
   * @param {Record<string, any>} changes
   * @param {'jugador'|'propuesta'|'bot'|'anfitrion'} origin
   */
  setParams(slot, changes, origin = 'jugador') {
    const ps = parseSlot(slot);
    if (!ps) return {};
    const ent = this.entityOf(slot);
    const applied = clampParams(ps.role, ps.sector, ent.params, changes);
    for (const [k, v] of Object.entries(applied)) {
      const old = ent.params[k];
      if (old === v) {
        delete applied[k];
        continue;
      }
      ent.params[k] = v;
      this.state.paramLog.push({ t: this.state.t, slot, param: k, old, new: v, origin });
    }
    if (ps.role === 'distributor' && 'trucks' in applied) syncTrucks(ent);
    if (Object.keys(applied).length) this.emit('params_applied', { slot, changes: applied, origin });
    return applied;
  }

  setController(slot, controller, reason = '') {
    const info = this.state.slots[slot];
    if (!info || info.controller === controller) return;
    info.controller = controller;
    this.state.controlLog.push({ t: this.state.t, slot, controller, reason });
    this.emit('controller', { slot, controller, reason });
  }

  /** Avanza una hora simulada. */
  step() {
    const st = this.state;
    if (st.over) return;
    updatePriceIndex(this);
    for (const s of SECTOR_IDS) producerTick(this, st.producers[s]);
    for (const s of SECTOR_IDS) distributorTick(this, st.distributors[s]);
    for (const s of SECTOR_IDS) buyerTick(this, st.buyers[s]);
    st.t += 1;
    if (st.t % 24 === 0) this.endOfDay();
    st.rngState = this.rng.state;
  }

  runHours(n) {
    for (let i = 0; i < n && !this.state.over; i++) this.step();
  }

  runDays(n) {
    this.runHours(n * 24);
  }

  endOfDay() {
    const st = this.state;
    const day = st.t / 24; // días completados
    for (const s of SECTOR_IDS) {
      const p = st.producers[s];
      p.ordersHist.push(p.acc.ordersIn);
      p.inputOrdersHist.push(p.acc.inputOrdered);
      const d = st.distributors[s];
      d.ordersHist.push(d.acc.ordered);
      d.toProducerHist.push(d.acc.toProducer);
      const b = st.buyers[s];
      for (const x of SECTOR_IDS) b.demandHist[x].push(b.acc.bySector[x]);
      b.totalDemandHist.push(b.acc.demand);
      b.ordersHist.push(b.acc.ordered);
      for (const arr of [
        p.ordersHist,
        p.inputOrdersHist,
        d.ordersHist,
        d.toProducerHist,
        b.totalDemandHist,
        b.ordersHist,
      ])
        if (arr.length > 120) arr.shift();
      for (const x of SECTOR_IDS) if (b.demandHist[x].length > 120) b.demandHist[x].shift();
    }

    if (this.recordKpi) st.kpiDaily.push({ day, slots: this.computeKpis() });

    // Quiebras: caja negativa más de BANKRUPTCY_DAYS días → BOT conservador
    for (const slot of ALL_SLOTS) {
      const ent = this.entityOf(slot);
      ent.negDays = ent.cash < 0 ? ent.negDays + 1 : 0;
      if (ent.negDays > BANKRUPTCY_DAYS && !ent.bankrupt) {
        ent.bankrupt = true;
        st.slots[slot].conservative = true;
        this.setController(slot, 'bot', 'quiebra');
        this.emit('bankrupt', { slot, cash: ent.cash, day });
        st.bankruptcies = st.bankruptcies || [];
        st.bankruptcies.push({ slot, day, cash: ent.cash });
      }
    }

    runBotsDaily(this);

    for (const s of SECTOR_IDS) {
      st.producers[s].acc = newAcc();
      st.distributors[s].acc = newDistAcc();
      st.buyers[s].acc = newBuyerAcc();
    }
    if (this.onDayEnd) this.onDayEnd(day);
    if (day >= st.days) {
      st.over = true;
      this.emit('game_over', { day });
    }
  }

  /** KPI del día en curso para los 9 puestos (§4.4). */
  computeKpis() {
    const st = this.state;
    /** @type {Record<string, any>} */
    const out = {};
    for (const s of SECTOR_IDS) {
      const p = st.producers[s];
      const pk = producerKpi({
        plannedH: p.acc.plannedH,
        runH: p.acc.runH,
        produced: p.acc.produced,
        good: p.acc.good,
        idealRate: SECTORS[s].ratePerHour,
        shipped: p.acc.shippedNow,
        requested: p.acc.requested,
        revenue: p.acc.revenue,
        costs: p.acc.costs,
      });
      // El rendimiento usa unidades reales frente a ideales en tiempo de marcha
      pk.performance = safeDiv(p.acc.actualUnits, p.acc.idealUnits, 0);
      pk.oee = pk.availability * pk.performance * pk.quality;
      const pd = Math.max(1, mean7(p.ordersHist));
      out[`producer-${s}`] = {
        ...r3(pk),
        cash: r2(p.cash),
        inventory: Math.round(p.fgStock),
        inputStock: Math.round(p.inputStock),
        coverage: r2(coverageDays(p.fgStock, pd)),
        backlog: Math.round(p.backlog),
        bullwhip: r2(bullwhip(p.inputOrdersHist, p.ordersHist)),
        status: p.machine.status,
      };

      const d = st.distributors[s];
      const dd = Math.max(1, mean7(d.ordersHist));
      const backlog = d.queue.reduce((a, o) => a + o.remaining, 0);
      out[`distributor-${s}`] = {
        otif: r3(safeDiv(d.acc.ordersOtif, d.acc.ordersDone, 1)),
        fillRate: r3(Math.min(1, safeDiv(d.acc.delivered, d.acc.ordered, 1))),
        leadP50: r2(percentile(d.leadTimes, 50)),
        leadP95: r2(percentile(d.leadTimes, 95)),
        inventory: Math.round(d.stock),
        coverage: r2(coverageDays(d.stock, dd)),
        fleetUtil: r3(safeDiv(d.acc.truckBusyH, d.acc.truckH, 0)),
        revenue: r2(d.acc.revenue),
        margin: r2(d.acc.revenue - d.acc.costs),
        cash: r2(d.cash),
        backlog: Math.round(backlog),
        price: r2(distPrice(this, d)),
        bullwhip: r2(bullwhip(d.toProducerHist, d.ordersHist)),
      };

      const b = st.buyers[s];
      let inv = 0;
      for (const x of SECTOR_IDS) inv += b.stock[x];
      const bd = Math.max(1, mean7(b.totalDemandHist));
      out[`buyer-${s}`] = {
        fillRate: r3(safeDiv(b.acc.sold, b.acc.demand, 1)),
        lost: Math.round(b.acc.lost),
        revenue: r2(b.acc.revenue),
        margin: r2(b.acc.revenue - b.acc.costs),
        cash: r2(b.cash),
        inventory: Math.round(inv),
        coverage: r2(coverageDays(inv, bd)),
        pending: Math.round(SECTOR_IDS.reduce((a, x) => a + b.onOrder[x], 0)),
        rejected: b.acc.rejected,
        bullwhip: r2(bullwhip(b.ordersHist, b.totalDemandHist)),
      };
    }
    return out;
  }

  /** Copia ligera del estado para Monte Carlo (sin historiales largos). */
  snapshotForMC() {
    const st = this.state;
    const copy = JSON.parse(JSON.stringify({ ...st, paramLog: [], controlLog: [], kpiDaily: [] }));
    copy.rngState = this.rng.state;
    return copy;
  }

  /** Caja total de un puesto (para objetivos de MC). */
  cashOf(slot) {
    return this.entityOf(slot).cash;
  }
}

function mean7(arr) {
  if (!arr.length) return 0;
  const k = Math.min(7, arr.length);
  let s = 0;
  for (let i = arr.length - k; i < arr.length; i++) s += arr[i];
  return s / k;
}

function r2(x) {
  return Math.round(x * 100) / 100;
}

function r3(obj) {
  if (typeof obj === 'number') return Math.round(obj * 1000) / 1000;
  /** @type {Record<string, number>} */
  const o = {};
  for (const [k, v] of Object.entries(obj)) o[k] = Math.abs(v) >= 100 ? r2(v) : Math.round(v * 1000) / 1000;
  return o;
}

/**
 * Reproduce una partida: aplica los cambios externos (jugador, propuesta, anfitrión) y los cambios de control
 * del registro en la hora en que ocurrieron. Los cambios con origen BOT se regeneran solos.
 */
export function replay({ seed, days, metrics, paramLog = [], controlLog = [], initialControllers }) {
  const eng = Engine.create({ seed, days, metrics, controllers: initialControllers });
  const ext = paramLog.filter((e) => e.origin !== 'bot');
  const ctl = controlLog.filter((e) => e.reason !== 'quiebra');
  let pi = 0;
  let ci = 0;
  while (!eng.state.over) {
    const t = eng.state.t;
    while (ci < ctl.length && ctl[ci].t <= t) {
      eng.setController(ctl[ci].slot, ctl[ci].controller, ctl[ci].reason);
      ci++;
    }
    while (pi < ext.length && ext[pi].t <= t) {
      const e = ext[pi];
      eng.setParams(e.slot, { [e.param]: e.new }, e.origin);
      pi++;
    }
    eng.step();
  }
  return eng;
}
