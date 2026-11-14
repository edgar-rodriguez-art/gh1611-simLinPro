// @ts-check
// Servidor autoritativo del anfitrión: ejecuta el motor, valida intenciones y difunde el estado.
import {
  ALL_SLOTS,
  SECTOR_IDS,
  REAL_SECONDS_PER_DAY,
  SNAPSHOT_HZ,
  DISCONNECT_BOT_MS,
  PROPOSAL_TTL_MS,
  SPEEDS,
} from '../config.js';
import { msg, validate, CLIENT_TO_HOST, sanitizeAlias } from './protocol.js';
import { botAcceptsProposal } from '../sim/bots.js';

const MAX_PLAYERS = 9;
const FULL_SNAPSHOT_MS = 5000;
const PING_TIMEOUT_MS = 15000;
const BOT_DECISION_MS = 1500;

let connSeq = 0;

export class HostServer {
  /**
   * @param {{engine:any, room:string, now?:()=>number}} opts
   */
  constructor({ engine, room, now }) {
    this.engine = engine;
    this.engine.emitEvents = true;
    this.room = room;
    this.now = now || (() => performance.now());
    /** @type {Map<string, any>} */
    this.clients = new Map();
    /** @type {Map<string, {alias:string, slot:string|null, connId:string|null, disconnectedAt:number|null}>} */
    this.players = new Map();
    this.speed = 1;
    this.paused = false;
    this.started = false;
    this.acc = 0;
    this.lastUpdate = this.now();
    this.lastSnapshot = 0;
    /** @type {Map<string, any>} */
    this.proposals = new Map();
    this.proposalLog = /** @type {any[]} */ ([]);
    this.netStats = { received: 0, rejected: 0, disconnections: 0, sent: 0 };
    this.chatLog = /** @type {any[]} */ ([]);
    /** @type {Record<string, Function[]>} */
    this.listeners = {};
    this.proposalSeq = 0;
    this.gameOverSent = false;
  }

  on(type, fn) {
    (this.listeners[type] ||= []).push(fn);
    return () => (this.listeners[type] = this.listeners[type].filter((f) => f !== fn));
  }

  fire(type, data) {
    (this.listeners[type] || []).forEach((f) => f(data));
  }

  /** Registra una conexión nueva (PeerJS o bucle local). */
  addConnection(conn) {
    const id = 'c' + ++connSeq;
    const client = { id, conn, playerId: null, alias: '', lastPing: this.now(), sent: new Map(), needFull: true };
    this.clients.set(id, client);
    conn.onMessage((raw) => this.handle(id, raw));
    conn.onClose(() => this.dropClient(id));
    return id;
  }

  connectedCount() {
    let n = 0;
    for (const c of this.clients.values()) if (c.playerId) n++;
    return n;
  }

  dropClient(id) {
    const c = this.clients.get(id);
    if (!c) return;
    this.clients.delete(id);
    if (c.playerId) {
      const p = this.players.get(c.playerId);
      if (p && p.connId === id) {
        p.connId = null;
        p.disconnectedAt = this.now();
        this.netStats.disconnections++;
        this.fire('player', { playerId: c.playerId, connected: false });
        this.broadcastRoom();
      }
    }
  }

  send(clientId, m) {
    const c = this.clients.get(clientId);
    if (c && c.conn.open) {
      c.conn.send(m);
      this.netStats.sent++;
      this.fire('traffic', {});
    }
  }

  broadcast(m) {
    for (const c of this.clients.values()) if (c.playerId) this.send(c.id, m);
  }

  handle(clientId, raw) {
    const c = this.clients.get(clientId);
    if (!c) return;
    this.netStats.received++;
    const res = validate(raw, CLIENT_TO_HOST);
    if (!res.ok) {
      this.netStats.rejected++;
      this.fire('rejected', { clientId, error: res.error });
      return;
    }
    const m = res.msg;
    this.fire('traffic', {});
    if (m.t !== 'hello' && !c.playerId) return; // primero debe saludar
    switch (m.t) {
      case 'hello':
        return this.onHello(c, m);
      case 'claim_role':
        return this.onClaim(c, m.slot);
      case 'set_params':
        return this.onSetParams(c, m.changes);
      case 'answer_proposal':
        return this.onAnswer(c, m.id, m.accept);
      case 'chat': {
        const text = String(m.text).slice(0, 300);
        const entry = { from: c.alias, text, t: this.engine.state.t };
        this.chatLog.push(entry);
        this.broadcast(msg('chat', { text, from: c.alias }));
        this.fire('chat', entry);
        return;
      }
      case 'ping':
        c.lastPing = this.now();
        return this.send(c.id, msg('pong', { ts: m.ts }));
      default:
    }
  }

  onHello(c, m) {
    const known = this.players.get(m.playerId);
    if (!known && this.connectedCount() >= MAX_PLAYERS) {
      this.send(c.id, msg('role_denied', { slot: '', reason: 'La sala está llena (máximo 9 jugadores).' }));
      return;
    }
    // Si el mismo jugador tenía otra conexión abierta, la sustituimos
    if (known && known.connId && known.connId !== c.id) {
      const old = this.clients.get(known.connId);
      if (old) {
        old.playerId = null;
        old.conn.close();
      }
    }
    c.playerId = m.playerId;
    c.alias = sanitizeAlias(m.alias);
    c.lastPing = this.now();
    c.needFull = true;
    const p = known || { alias: c.alias, slot: null, connId: null, disconnectedAt: null };
    p.alias = c.alias;
    p.connId = c.id;
    p.disconnectedAt = null;
    this.players.set(m.playerId, p);
    this.send(c.id, this.roomStateMsg());
    if (p.slot) {
      // Reconexión: recupera el control
      this.engine.setController(p.slot, 'human', 'reconexion');
      this.grant(c, p.slot);
    }
    this.fire('player', { playerId: m.playerId, connected: true });
    this.broadcastRoom();
  }

  slotOwner(slot) {
    for (const [pid, p] of this.players) if (p.slot === slot) return pid;
    return null;
  }

  onClaim(c, slot) {
    const owner = this.slotOwner(slot);
    if (owner && owner !== c.playerId) {
      this.send(c.id, msg('role_denied', { slot, reason: 'Ese puesto ya está ocupado por otra persona.' }));
      return;
    }
    const p = this.players.get(c.playerId);
    if (!p) return;
    if (p.slot && p.slot !== slot) this.engine.setController(p.slot, 'bot', 'cambio de puesto');
    p.slot = slot;
    this.engine.setController(slot, 'human', 'jugador');
    this.grant(c, slot);
    this.broadcastRoom();
  }

  grant(c, slot) {
    this.send(c.id, msg('role_granted', { slot, playerId: c.playerId, params: this.engine.getParams(slot) }));
    c.needFull = true;
    this.sendSnapshot(c, true);
  }

  onSetParams(c, changes) {
    const p = this.players.get(c.playerId);
    if (!p || !p.slot) return;
    if (this.engine.state.slots[p.slot].controller !== 'human') {
      this.send(c.id, msg('chat', { text: 'Tu puesto está en manos de un BOT (quiebra o desconexión).', from: 'sistema' }));
      return;
    }
    this.applyParams(p.slot, changes, 'jugador');
  }

  /** Aplica parámetros (desde jugador, propuesta o anfitrión) y lo comunica a todos. */
  applyParams(slot, changes, origin) {
    const applied = this.engine.setParams(slot, changes, origin);
    if (Object.keys(applied).length) {
      this.broadcast(msg('params_applied', { slot, changes: applied, origin }));
      this.fire('params', { slot, changes: applied, origin });
    }
    return applied;
  }

  // ───────────── Propuestas ─────────────

  /**
   * Envía una propuesta elegida por el anfitrión. Nunca se envía sola.
   * @param {{slot:string, changes:Record<string,any>, delta:Record<string,number>, pImprove:number, riskP5:number, kpiLabel?:string}} cand
   */
  sendProposal(cand) {
    const id = 'p' + ++this.proposalSeq + '-' + Math.floor(this.engine.state.t);
    const before = {};
    const cur = this.engine.getParams(cand.slot);
    for (const k of Object.keys(cand.changes)) before[k] = cur[k];
    const now = this.now();
    const prop = {
      id,
      slot: cand.slot,
      changes: cand.changes,
      before,
      delta: cand.delta,
      pImprove: cand.pImprove,
      riskP5: cand.riskP5,
      kpiLabel: cand.kpiLabel || '',
      sentAt: now,
      expiresAt: now + PROPOSAL_TTL_MS,
      simT: this.engine.state.t,
      status: 'pendiente',
      byBot: false,
    };
    this.proposals.set(id, prop);
    this.broadcastEvents([{ type: 'proposal_flash', t: this.engine.state.t, slot: cand.slot }]);
    const ownerId = this.slotOwner(cand.slot);
    const owner = ownerId ? this.players.get(ownerId) : null;
    const human = this.engine.state.slots[cand.slot].controller === 'human' && owner && owner.connId;
    if (human) {
      this.send(
        owner.connId,
        msg('proposal', {
          id,
          slot: cand.slot,
          changes: cand.changes,
          before,
          delta: cand.delta,
          pImprove: cand.pImprove,
          riskP5: cand.riskP5,
          ttlMs: PROPOSAL_TTL_MS,
          kpiLabel: prop.kpiLabel,
        }),
      );
    } else {
      prop.byBot = true;
      prop.botDecideAt = now + BOT_DECISION_MS;
    }
    this.fire('proposal', prop);
    return prop;
  }

  /** Propuesta local (modo demo: el jugador está en este mismo dispositivo). */
  answerLocal(id, accept) {
    const p = this.proposals.get(id);
    if (p) this.resolveProposal(p, accept ? 'aceptada' : 'rechazada');
  }

  onAnswer(c, id, accept) {
    const prop = this.proposals.get(id);
    const p = this.players.get(c.playerId);
    if (!prop || !p || p.slot !== prop.slot || prop.status !== 'pendiente') return;
    this.resolveProposal(prop, accept ? 'aceptada' : 'rechazada');
  }

  resolveProposal(prop, status) {
    if (prop.status !== 'pendiente') return;
    prop.status = status;
    prop.responseMs = Math.round(this.now() - prop.sentAt);
    this.proposals.delete(prop.id);
    if (status === 'aceptada') this.applyParams(prop.slot, prop.changes, 'propuesta');
    const entry = {
      id: prop.id,
      t: prop.simT,
      slot: prop.slot,
      changes: prop.changes,
      before: prop.before,
      delta: prop.delta,
      pImprove: prop.pImprove,
      riskP5: prop.riskP5,
      decision: status,
      decidedBy: prop.byBot ? 'bot' : 'jugador',
      responseMs: prop.responseMs,
    };
    this.proposalLog.push(entry);
    this.fire('proposal_resolved', entry);
  }

  // ───────────── Bucle ─────────────

  start() {
    this.started = true;
    this.lastUpdate = this.now();
    this.broadcastRoom();
  }

  setSpeed(s) {
    if (SPEEDS.includes(s)) this.speed = s;
    this.broadcastRoom();
  }

  setPaused(p) {
    this.paused = !!p;
    this.broadcastRoom();
  }

  /** Tiempo simulado fraccionario (horas). */
  simTime() {
    return this.engine.state.t + this.acc;
  }

  /** Llamar en cada fotograma (o con setInterval). */
  update() {
    const now = this.now();
    const dt = Math.min(1000, now - this.lastUpdate);
    this.lastUpdate = now;
    const eng = this.engine;
    if (this.started && !this.paused && !eng.state.over) {
      this.acc += (dt * this.speed * 24) / (REAL_SECONDS_PER_DAY * 1000);
      let n = 0;
      while (this.acc >= 1 && n < 8 && !eng.state.over) {
        eng.step();
        this.acc -= 1;
        n++;
      }
      if (this.acc > 1) this.acc = 0.99;
    }
    const ev = eng.drainEvents();
    if (ev.length) this.broadcastEvents(ev);

    // Desconexiones: el BOT toma el puesto tras 15 s, conservando los parámetros
    for (const [pid, p] of this.players) {
      if (p.slot && !p.connId && p.disconnectedAt !== null && now - p.disconnectedAt > DISCONNECT_BOT_MS) {
        if (eng.state.slots[p.slot].controller === 'human') {
          eng.setController(p.slot, 'bot', 'desconexion');
          this.fire('player', { playerId: pid, connected: false, bot: true });
          this.broadcastRoom();
        }
      }
    }
    for (const c of this.clients.values()) {
      if (c.playerId && now - c.lastPing > PING_TIMEOUT_MS) {
        c.conn.close();
        this.dropClient(c.id);
      }
    }
    // Propuestas: expiración (cuenta como rechazada) y decisión de los BOT
    for (const prop of [...this.proposals.values()]) {
      if (prop.byBot && now >= prop.botDecideAt) {
        this.resolveProposal(prop, botAcceptsProposal(prop) ? 'aceptada' : 'rechazada');
      } else if (now >= prop.expiresAt) {
        this.resolveProposal(prop, 'expirada');
      }
    }
    if (now - this.lastSnapshot >= 1000 / SNAPSHOT_HZ) {
      this.lastSnapshot = now;
      for (const c of this.clients.values()) if (c.playerId) this.sendSnapshot(c, false);
    }
    if (eng.state.over && !this.gameOverSent) {
      this.gameOverSent = true;
      const summary = this.summary();
      this.broadcast(msg('game_over', { summary }));
      this.fire('game_over', summary);
    }
  }

  broadcastEvents(events) {
    // Se envían solo los campos útiles para animar
    this.broadcast(msg('event', { events }));
    this.fire('events', events);
  }

  roomStateMsg() {
    /** @type {Record<string, any>} */
    const slots = {};
    for (const slot of ALL_SLOTS) {
      const owner = this.slotOwner(slot);
      const p = owner ? this.players.get(owner) : null;
      slots[slot] = {
        controller: this.engine.state.slots[slot].controller,
        alias: p ? p.alias : null,
        connected: !!(p && p.connId),
      };
    }
    return msg('room_state', {
      room: this.room,
      slots,
      started: this.started,
      speed: this.speed,
      day: Math.floor(this.engine.state.t / 24),
      days: this.engine.state.days,
      paused: this.paused,
    });
  }

  broadcastRoom() {
    const m = this.roomStateMsg();
    this.broadcast(m);
    this.fire('room', m);
  }

  requestLogs() {
    this.broadcast(msg('log_request', {}));
  }

  /** Construye el snapshot (completo o con deltas) para un cliente. */
  sendSnapshot(c, forceFull) {
    const now = this.now();
    const data = buildSnapshotData(this.engine, forceFull || c.needFull);
    const full = forceFull || c.needFull || now - (c.lastFull || 0) > FULL_SNAPSHOT_MS;
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      const s = JSON.stringify(v);
      if (full || c.sent.get(k) !== s) {
        out[k] = v;
        c.sent.set(k, s);
      }
    }
    if (full) {
      c.lastFull = now;
      c.needFull = false;
    }
    this.send(
      c.id,
      msg('snapshot', { simT: this.simTime(), speed: this.speed, paused: this.paused || !this.started, full, data: out }),
    );
  }

  summary() {
    const last = this.engine.state.kpiDaily.at(-1);
    return {
      days: this.engine.state.days,
      kpi: last ? last.slots : {},
      bankruptcies: this.engine.state.bankruptcies || [],
      proposals: this.proposalLog.length,
    };
  }
}

/** Estado compacto para clientes y escena. Las claves son rutas planas para enviar deltas. */
export function buildSnapshotData(engine, includeHistory = false) {
  const st = engine.state;
  /** @type {Record<string, any>} */
  const d = {};
  d.meta = { t: st.t, day: Math.floor(st.t / 24), days: st.days, over: st.over, priceIndex: st.priceIndex };
  d.slots = st.slots;
  for (const s of SECTOR_IDS) {
    const p = st.producers[s];
    d['P.' + s] = {
      cash: Math.round(p.cash),
      inputStock: Math.round(p.inputStock),
      fgStock: Math.round(p.fgStock),
      status: p.machine.status,
      lot: p.lot ? [Math.round(p.lot.done), p.lot.size, p.lot.setupLeft > 0 ? 1 : 0] : null,
      backlog: Math.round(p.backlog),
      inbound: p.inputOrders.length,
      params: p.params,
    };
    const ds = st.distributors[s];
    d['D.' + s] = {
      cash: Math.round(ds.cash),
      stock: Math.round(ds.stock),
      queue: ds.queue.reduce((a, o) => a + o.remaining, 0),
      trucks: ds.trucks.map((tr) => ({
        id: tr.id,
        status: tr.status,
        dest: tr.dest || null,
        departAt: tr.departAt || 0,
        arriveAt: tr.arriveAt || 0,
        returnAt: tr.returnAt || 0,
        qty: tr.qty || 0,
      })),
      params: ds.params,
    };
    const b = st.buyers[s];
    d['B.' + s] = {
      cash: Math.round(b.cash),
      stock: Object.fromEntries(SECTOR_IDS.map((x) => [x, Math.round(b.stock[x])])),
      onOrder: Object.fromEntries(SECTOR_IDS.map((x) => [x, Math.round(b.onOrder[x])])),
      params: b.params,
    };
  }
  const last = st.kpiDaily.at(-1);
  d.kpi = last ? last.slots : null;
  if (includeHistory) d.kpiHist = st.kpiDaily.slice(-90);
  return d;
}
