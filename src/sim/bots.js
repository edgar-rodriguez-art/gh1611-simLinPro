// @ts-check
// Políticas BOT por rol (§5). Son deterministas: dependen solo del estado del motor.
import { SECTORS, PARAM_DEFS, clampParams } from '../config.js';
import { producerDailyDemand } from './entities/producer.js';

/** Se ejecuta al cerrar cada día para los puestos controlados por BOT. */
export function runBotsDaily(engine) {
  const st = engine.state;
  for (const [slot, info] of Object.entries(st.slots)) {
    if (info.controller !== 'bot') continue;
    const [role, sector] = slot.split('-');
    if (role === 'producer') producerBot(engine, slot, sector, info.conservative);
    else if (role === 'distributor') distributorBot(engine, slot, sector, info.conservative);
    else if (role === 'buyer') buyerBot(engine, slot, sector, info.conservative);
  }
}

function producerBot(engine, slot, sector, conservative) {
  const p = engine.state.producers[sector];
  const demand = producerDailyDemand(engine, p);
  const [lo, hi] = PARAM_DEFS.producer.lotSize.range(sector);
  /** @type {Record<string, any>} */
  const ch = {};
  // Lote ≈ demanda media de 7 días (con banda muerta del 15 % para no oscilar)
  const target = Math.min(hi, Math.max(lo, Math.round(demand)));
  if (Math.abs(target - p.params.lotSize) / p.params.lotSize > 0.15) ch.lotSize = target;
  if (conservative) {
    const sec = SECTORS[sector];
    const needShifts = Math.ceil((demand * 1.1) / (sec.ratePerHour * 8 * 0.85));
    ch.shifts = Math.min(3, Math.max(1, needShifts));
    ch.price = Math.round(sec.refCost * 1.25 * 100) / 100;
    ch.inspection = 'medium';
    ch.maintenance = 5;
  }
  apply(engine, slot, ch);
}

function distributorBot(engine, slot, sector, conservative) {
  if (!conservative) return; // el despacho 80 %/plazo se aplica en el motor
  apply(engine, slot, { margin: 15, s: 2, Q: 4 });
}

function buyerBot(engine, slot, sector, conservative) {
  if (!conservative) return; // usa la demanda base (ver buyerTick)
  apply(engine, slot, { demandPct: 100, safetyDays: 1, orderEvery: 1 });
}

function apply(engine, slot, ch) {
  if (!Object.keys(ch).length) return;
  const [role, sector] = slot.split('-');
  const cur = engine.getParams(slot);
  const clamped = clampParams(role, sector, cur, ch);
  /** @type {Record<string, any>} */
  const diff = {};
  for (const [k, v] of Object.entries(clamped)) if (cur[k] !== v) diff[k] = v;
  if (Object.keys(diff).length) engine.setParams(slot, diff, 'bot');
}

/**
 * Decisión del BOT ante una propuesta del anfitrión (§5):
 * acepta solo si P(mejora) ≥ 0.6 y el riesgo P5 no empeora más de un 5 %.
 */
export function botAcceptsProposal(proposal) {
  return proposal.pImprove >= 0.6 && proposal.riskP5 <= 0.05;
}
