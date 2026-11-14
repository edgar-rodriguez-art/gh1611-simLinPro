// @ts-check
// Bitácora de partida: la generan el anfitrión y cada jugador (§10.1). Sin datos personales.
import { LOG_SCHEMA_VERSION, ROLE_FILE, SECTOR_FILE, parseSlot } from '../config.js';
import { MAX_LOG_BYTES } from './schema.js';
import { percentile } from '../sim/kpi.js';

const MAX_EVENTS = 3000;
const MAX_ERRORS = 200;
const LOGGED_EVENTS = new Set([
  'breakdown',
  'repair',
  'stockout',
  'bankrupt',
  'controller',
  'price_rejected',
  'game_over',
]);

export function appVersion() {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
}
export function commitSha() {
  return typeof __COMMIT_SHA__ !== 'undefined' ? __COMMIT_SHA__ : 'local';
}

/** Alias apto para nombre de archivo. */
export function slugAlias(alias) {
  return (
    String(alias || 'anonimo')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20) || 'anonimo'
  );
}

export class GameLogger {
  /**
   * @param {{role:'host'|'producer'|'distributor'|'buyer', sector:string|null, alias:string, room:string,
   *          seed:number, config:{velocidad:number, dias:number, nMC:number}, fuenteDatos:any, partidaId:string,
   *          modo?:'red'|'demo', mobile?:boolean}} o
   */
  constructor(o) {
    this.o = o;
    this.inicio = new Date().toISOString();
    this.fin = /** @type {string|null} */ (null);
    this.parametros = /** @type {any[]} */ ([]);
    this.propuestas = /** @type {any[]} */ ([]);
    this.kpiDiarios = /** @type {any[]} */ ([]);
    this.eventos = /** @type {any[]} */ ([]);
    this.errores = /** @type {any[]} */ ([]);
    this.feedback = { valoracion: /** @type {number|null} */ (null), texto: '' };
    this.red = {
      latenciaP50: null,
      latenciaP95: null,
      desconexiones: 0,
      mensajesRechazados: 0,
      mensajesRecibidos: 0,
    };
    this.fps = /** @type {number[]} */ ([]);
    this.mcMs = /** @type {number[]} */ ([]);
    /** @type {any} */
    this.registro = null;
    this.stockoutAgg = new Map();
  }

  setSlot(slot) {
    const p = parseSlot(slot);
    if (p) {
      this.o.role = p.role;
      this.o.sector = p.sector;
    }
  }

  /** Cambio de parámetro (entrada del paramLog del motor). */
  param(e) {
    this.parametros.push({
      t: e.t,
      puesto: e.slot,
      parametro: e.param,
      anterior: e.old ?? null,
      nuevo: e.new ?? null,
      origen: e.origin,
    });
  }

  proposal(p) {
    this.propuestas.push({
      id: p.id,
      t: p.t ?? 0,
      puesto: p.slot,
      cambios: p.changes,
      anterior: p.before || {},
      deltaEsperada: p.delta || {},
      pMejora: Math.min(1, Math.max(0, p.pImprove ?? 0)),
      riesgoP5: p.riskP5 ?? 0,
      decision: p.decision,
      decididoPor: p.decidedBy || 'jugador',
      tiempoRespuestaMs: p.responseMs ?? null,
    });
  }

  /** Eventos del motor relevantes (averías, roturas de stock agregadas por día, quiebras, cambios de control). */
  events(list) {
    for (const ev of list) {
      if (!LOGGED_EVENTS.has(ev.type)) continue;
      if (ev.type === 'stockout') {
        const key = `${Math.floor(ev.t / 24)}|${ev.sector}|${ev.buyer}`;
        const agg = this.stockoutAgg.get(key);
        if (agg) {
          agg.perdidas += ev.lost || 0;
          continue;
        }
        const e = {
          t: ev.t,
          tipo: 'rotura_stock',
          dia: Math.floor(ev.t / 24),
          sector: ev.sector,
          comprador: ev.buyer,
          perdidas: ev.lost || 0,
        };
        this.stockoutAgg.set(key, e);
        this.pushEvent(e);
        continue;
      }
      const { type, t, ...rest } = ev;
      const tipo =
        {
          breakdown: 'averia',
          repair: 'reparacion',
          bankrupt: 'quiebra',
          controller: 'control',
          price_rejected: 'precio_rechazado',
          game_over: 'fin',
        }[type] || type;
      this.pushEvent({ t, tipo, dia: Math.floor(t / 24), ...rest });
    }
  }

  pushEvent(e) {
    if (this.eventos.length < MAX_EVENTS) this.eventos.push(e);
  }

  /** KPI del día: el anfitrión guarda todos los puestos; el jugador, el suyo. */
  kpiDay(day, slots, slot = null) {
    if (this.kpiDiarios.some((k) => k.dia === day)) return;
    if (slot) this.kpiDiarios.push({ dia: day, puesto: slot, kpi: slots[slot] });
    else this.kpiDiarios.push({ dia: day, puestos: slots });
  }

  error(message, stack, fatal = false) {
    if (this.errores.length >= MAX_ERRORS) return;
    this.errores.push({
      mensaje: String(message || 'error').slice(0, 500),
      stack: String(stack || '')
        .split('\n')
        .slice(0, 8)
        .join('\n')
        .slice(0, 2000),
      t: new Date().toISOString(),
      fatal,
    });
  }

  /** Captura window.onerror y unhandledrejection. */
  installErrorHandlers(win) {
    win.addEventListener('error', (e) => this.error(e.message, e.error && e.error.stack));
    win.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      this.error(r && r.message ? r.message : String(r), r && r.stack);
    });
  }

  sampleFps(fps) {
    if (Number.isFinite(fps) && fps > 0) {
      this.fps.push(Math.round(fps));
      if (this.fps.length > 3600) this.fps.shift();
    }
  }

  setNet({ rtts = [], disconnections = 0, rejected = 0, received = 0 }) {
    this.red = {
      latenciaP50: rtts.length ? Math.round(percentile(rtts, 50)) : null,
      latenciaP95: rtts.length ? Math.round(percentile(rtts, 95)) : null,
      desconexiones: disconnections,
      mensajesRechazados: rejected,
      mensajesRecibidos: received,
    };
  }

  setFeedback(valoracion, texto) {
    this.feedback = {
      valoracion: valoracion ? Math.min(5, Math.max(1, Math.round(valoracion))) : null,
      texto: String(texto || '').slice(0, 2000),
    };
  }

  setRegistro(r) {
    this.registro = r;
  }

  finish() {
    this.fin = new Date().toISOString();
  }

  build() {
    const o = this.o;
    const fpsMedio = this.fps.length
      ? Math.round(this.fps.reduce((a, b) => a + b, 0) / this.fps.length)
      : null;
    /** @type {Record<string, any>} */
    const log = {
      schemaVersion: LOG_SCHEMA_VERSION,
      appVersion: appVersion(),
      commitSha: commitSha(),
      partidaId: o.partidaId,
      sala: o.room,
      rol: o.role === 'host' ? 'anfitrion' : ROLE_FILE[o.role],
      sector: o.role === 'host' || !o.sector ? null : SECTOR_FILE[o.sector],
      alias: String(o.alias || 'anonimo').slice(0, 20),
      semilla: o.seed >>> 0,
      modo: o.modo || 'red',
      config: o.config,
      fuenteDatos: o.fuenteDatos || {},
      inicio: this.inicio,
      fin: this.fin,
      parametros: this.parametros,
      propuestas: this.propuestas,
      kpiDiarios: this.kpiDiarios,
      eventos: this.eventos,
      red: this.red,
      rendimiento: {
        fpsMedio,
        fpsMin: this.fps.length ? Math.min(...this.fps.slice(30)) || Math.min(...this.fps) : null,
        mcMs: this.mcMs.map((x) => Math.round(x)),
        dispositivo: o.mobile ? 'movil' : 'escritorio',
      },
      errores: this.errores,
      feedback: this.feedback,
    };
    if (this.registro) log.registro = this.registro;
    return compactIfNeeded(JSON.parse(JSON.stringify(log)));
  }

  filename(date = new Date()) {
    const d = date.toISOString().slice(0, 10);
    const o = this.o;
    const who = o.role === 'host' ? 'anfitrion' : `${ROLE_FILE[o.role]}-${SECTOR_FILE[o.sector]}`;
    return `${d}_${o.room}_${who}_${slugAlias(o.alias)}.json`;
  }

  /** Descarga en el navegador. */
  download() {
    const blob = new Blob([JSON.stringify(this.build(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.filename();
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }
}

/** Si la bitácora supera 2 MB, compacta los KPI (redondeo y un día de cada dos) y recorta eventos. */
export function compactIfNeeded(log) {
  let s = JSON.stringify(log);
  if (s.length <= MAX_LOG_BYTES) return log;
  const round = (v) =>
    typeof v === 'number'
      ? Math.round(v * 100) / 100
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]))
        : v;
  log.kpiDiarios = log.kpiDiarios.map(round);
  log.compactado = true;
  s = JSON.stringify(log);
  let guard = 0;
  while (s.length > MAX_LOG_BYTES && guard++ < 6) {
    if (log.kpiDiarios.length > 10)
      log.kpiDiarios = log.kpiDiarios.filter((_, i) => i % 2 === 0 || i === log.kpiDiarios.length - 1);
    if (log.eventos.length > 200) log.eventos = log.eventos.slice(0, Math.floor(log.eventos.length / 2));
    s = JSON.stringify(log);
  }
  return log;
}
