// @ts-check
// Cliente del jugador: envía intenciones, recibe snapshots y los interpola.
import { PING_MS, REAL_SECONDS_PER_DAY } from '../config.js';
import { msg, validate, HOST_TO_CLIENT, peerIdFor } from './protocol.js';
import { peerConn, PEER_OPTIONS, describePeerError } from './transport.js';
import { percentile } from '../sim/kpi.js';

/** Identificador estable del jugador (sessionStorage) para reconectar. */
export function getPlayerId() {
  const key = 'simlinpro.playerId';
  try {
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = 'pl-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'pl-' + Math.random().toString(36).slice(2, 12);
  }
}

export class GameClient {
  /**
   * @param {{playerId:string, alias:string, now?:()=>number}} opts
   */
  constructor({ playerId, alias, now }) {
    this.playerId = playerId;
    this.alias = alias;
    this.now = now || (() => performance.now());
    /** @type {any} */
    this.conn = null;
    this.slot = /** @type {string|null} */ (null);
    /** @type {Record<string, any>} */
    this.data = {};
    this.kpiHist = /** @type {any[]} */ ([]);
    this.room = /** @type {any} */ (null);
    this.simT = 0;
    this.simTAt = 0;
    this.speed = 1;
    this.paused = true;
    this.rtts = /** @type {number[]} */ ([]);
    this.lastRtt = 0;
    this.stats = { disconnections: 0, rejected: 0, received: 0 };
    /** @type {Record<string, Function[]>} */
    this.listeners = {};
    this.pingTimer = /** @type {any} */ (null);
    this.closedByUser = false;
    this.peer = /** @type {any} */ (null);
    this.code = '';
    this.retries = 0;
  }

  on(type, fn) {
    (this.listeners[type] ||= []).push(fn);
    return () => (this.listeners[type] = this.listeners[type].filter((f) => f !== fn));
  }

  fire(type, data) {
    (this.listeners[type] || []).forEach((f) => f(data));
  }

  /** Usa una conexión ya abierta (bucle local o PeerJS). */
  attach(conn) {
    this.conn = conn;
    conn.onMessage((raw) => this.handle(raw));
    conn.onClose(() => this.onClosed());
    conn.send(msg('hello', { playerId: this.playerId, alias: this.alias, appVersion: safeVersion() }));
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.ping(), PING_MS);
    this.ping();
    this.fire('status', { state: 'conectado' });
  }

  /** Conecta con PeerJS a la sala `code`. */
  async connect(code) {
    this.code = code;
    const { Peer } = await import('peerjs');
    if (!this.peer || this.peer.destroyed) {
      this.peer = new Peer(PEER_OPTIONS);
      this.peer.on('error', (err) => {
        this.fire('status', { state: 'error', message: describePeerError(err), type: err.type });
      });
    }
    const open = () =>
      new Promise((resolve, reject) => {
        if (this.peer.open) return resolve(null);
        const to = setTimeout(() => reject({ type: 'network', message: 'tiempo de espera agotado' }), 12000);
        this.peer.once('open', () => {
          clearTimeout(to);
          resolve(null);
        });
        this.peer.once('error', (e) => {
          clearTimeout(to);
          reject(e);
        });
      });
    this.fire('status', { state: 'conectando' });
    await open();
    await new Promise((resolve, reject) => {
      const dc = this.peer.connect(peerIdFor(code), { reliable: true, serialization: 'raw' });
      const to = setTimeout(() => reject({ type: 'webrtc', message: 'no se pudo abrir el canal' }), 15000);
      dc.on('open', () => {
        clearTimeout(to);
        this.retries = 0;
        this.attach(peerConn(dc));
        resolve(null);
      });
      dc.on('error', (e) => {
        clearTimeout(to);
        reject(e);
      });
    });
  }

  onClosed() {
    clearInterval(this.pingTimer);
    if (this.closedByUser) return;
    this.stats.disconnections++;
    this.fire('status', { state: 'desconectado' });
    if (this.code && this.retries < 10) {
      const wait = Math.min(8000, 1000 * 2 ** this.retries);
      this.retries++;
      setTimeout(() => {
        this.connect(this.code).catch((e) => {
          this.fire('status', { state: 'error', message: describePeerError(e), type: e && e.type });
          this.onClosed();
        });
      }, wait);
    }
  }

  close() {
    this.closedByUser = true;
    clearInterval(this.pingTimer);
    if (this.conn) this.conn.close();
    if (this.peer) this.peer.destroy();
  }

  send(m) {
    if (this.conn && this.conn.open) this.conn.send(m);
  }

  ping() {
    this.send(msg('ping', { ts: this.now() }));
  }

  claim(slot) {
    this.send(msg('claim_role', { slot }));
  }

  setParams(changes) {
    this.send(msg('set_params', { changes }));
  }

  answerProposal(id, accept) {
    this.send(msg('answer_proposal', { id, accept }));
  }

  chat(text) {
    this.send(msg('chat', { text: String(text).slice(0, 300) }));
  }

  /** Tiempo simulado interpolado (horas). */
  simTime() {
    if (this.paused) return this.simT;
    const dt = this.now() - this.simTAt;
    const adv = (dt * this.speed * 24) / (REAL_SECONDS_PER_DAY * 1000);
    return this.simT + Math.min(adv, 1.5);
  }

  latency() {
    return {
      last: Math.round(this.lastRtt),
      p50: Math.round(percentile(this.rtts, 50)),
      p95: Math.round(percentile(this.rtts, 95)),
    };
  }

  handle(raw) {
    this.stats.received++;
    const res = validate(raw, HOST_TO_CLIENT);
    if (!res.ok) {
      this.stats.rejected++;
      return;
    }
    const m = res.msg;
    switch (m.t) {
      case 'pong': {
        const rtt = this.now() - m.ts;
        this.lastRtt = rtt;
        this.rtts.push(rtt);
        if (this.rtts.length > 500) this.rtts.shift();
        this.fire('latency', this.latency());
        break;
      }
      case 'room_state':
        this.room = m;
        this.fire('room', m);
        break;
      case 'role_granted':
        this.slot = m.slot;
        this.fire('granted', m);
        break;
      case 'role_denied':
        this.fire('denied', m);
        break;
      case 'snapshot':
        this.applySnapshot(m);
        break;
      case 'event':
        this.fire('events', m.events);
        break;
      case 'params_applied':
        if (this.data[keyFor(m.slot)]) Object.assign(this.data[keyFor(m.slot)].params, m.changes);
        this.fire('params', m);
        break;
      case 'proposal':
        this.fire('proposal', m);
        break;
      case 'chat':
        this.fire('chat', m);
        break;
      case 'game_over':
        this.fire('game_over', m.summary);
        break;
      case 'log_request':
        this.fire('log_request', {});
        break;
      default:
    }
  }

  applySnapshot(m) {
    if (m.full) this.data = {};
    const prevDay = this.data.meta ? this.data.meta.day : -1;
    for (const [k, v] of Object.entries(m.data)) {
      if (k === 'kpiHist') {
        this.kpiHist = v;
        continue;
      }
      this.data[k] = v;
    }
    const day = this.data.meta ? this.data.meta.day : 0;
    if (this.data.kpi && day !== prevDay && day > 0 && !this.kpiHist.some((x) => x.day === day)) {
      this.kpiHist.push({ day, slots: this.data.kpi });
    }
    this.simT = m.simT;
    this.simTAt = this.now();
    this.speed = m.speed;
    this.paused = m.paused;
    this.fire('snapshot', this.data);
  }
}

function keyFor(slot) {
  const [role, sector] = slot.split('-');
  return { producer: 'P.', distributor: 'D.', buyer: 'B.' }[role] + sector;
}

function safeVersion() {
  try {
    return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
  } catch {
    return 'dev';
  }
}
