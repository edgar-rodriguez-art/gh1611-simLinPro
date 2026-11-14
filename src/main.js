// @ts-check
// Arranque y enrutado: lobby → anfitrión (servidor), jugador (cliente) o demo local.
import './ui/styles.css';
import { h, toast, fmt, isMobile, prefersReducedMotion } from './ui/dom.js';
import { renderLobby, slotMap, footer } from './ui/lobby.js';
import { iconSvg } from './ui/icons.js';
import { producerHud } from './ui/hud-producer.js';
import { distributorHud } from './ui/hud-distributor.js';
import { buyerHud } from './ui/hud-buyer.js';
import { buildHostDashboard } from './ui/host-dashboard.js';
import { showProposal } from './ui/proposal-modal.js';
import { Engine } from './sim/engine.js';
import { hash32 } from './sim/rng.js';
import { analyzeSlot, workerPool, localRunner } from './sim/proposals.js';
import { HostServer, buildSnapshotData } from './net/host.js';
import { GameClient, getPlayerId } from './net/client.js';
import { loopbackPair, peerConn, PEER_OPTIONS, describePeerError } from './net/transport.js';
import { peerIdFor, isValidRoomCode } from './net/protocol.js';
import { loadMetrics, toEngineMetrics } from './data/metrics.js';
import { GameLogger } from './log/logger.js';
import { CODE_ALPHABET, ROLE_LABELS, SECTORS, SECTOR_IDS, parseSlot, ALL_SLOTS } from './config.js';

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
const BASE = import.meta.env.BASE_URL;
const SAVE_KEY = 'simlinpro.partida';
const mobile = isMobile();
const reduced = prefersReducedMotion();

/** @type {GameLogger[]} */
let loggers = [];
window.addEventListener('error', (e) => loggers.forEach((l) => l.error(e.message, e.error && e.error.stack)));
window.addEventListener('unhandledrejection', (e) => {
  const r = /** @type {any} */ (e).reason;
  loggers.forEach((l) => l.error(r && r.message ? r.message : String(r), r && r.stack));
});

/** @type {null | (() => void)} */
let teardown = null;

function genCode() {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}

function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s && s.state && !s.state.over && Date.now() - s.savedAt < 12 * 3600 * 1000) return s;
  } catch {
    /* sin almacenamiento */
  }
  return null;
}

function showLobby(message = '') {
  teardown?.();
  teardown = null;
  loggers = [];
  const code = (new URLSearchParams(location.search).get('sala') || '').toUpperCase();
  const saved = loadSaved();
  renderLobby(app, {
    prefillCode: isValidRoomCode(code) ? code : '',
    message,
    saved,
    onResume: () => saved && startHost({ alias: saved.alias, days: saved.state.days, n: saved.n }, saved),
    onCreate: (o) => startHost(o),
    onJoin: (c, alias) => startJoin(c, alias),
    onDemo: (slot, alias, o) => startDemo(slot, alias, o),
  });
  if (code && isValidRoomCode(code))
    /** @type {HTMLInputElement|null} */ (app.querySelector('#join-alias'))?.focus();
}

function loading(text) {
  app.innerHTML = '';
  app.append(h('main', { class: 'lobby' }, [h('div', { class: 'card' }, [h('p', { text })]), footer()]));
}

/** Pantalla de juego común: barra superior, escena y panel lateral (bottom sheet en móvil). */
async function gameScreen({ wide = false }) {
  app.innerHTML = '';
  const chips = h('div', { class: 'row grow' });
  const actions = h('div', { class: 'row' });
  const sceneEl = h('div', { id: 'scene' });
  const tools = h('div', { class: 'scene-tools' });
  const legend = h('div', { class: 'legend', 'aria-hidden': 'true' }, [
    h('div', { html: '<i style="background:#1f9d55"></i>Material' }),
    h('div', { html: '<i style="background:#d99a00"></i>Dinero (EUR)' }),
    h('div', { html: '<i style="background:#7b4fd6"></i>Red PeerJS' }),
  ]);
  sceneEl.append(tools, legend);
  const panel = h('aside', { class: 'panel' + (mobile ? ' collapsed' : ''), 'aria-label': 'Panel' });
  const handle = h('button', {
    class: 'sheet-handle',
    text: 'Panel',
    onclick: () => panel.classList.toggle('collapsed'),
  });
  const panelBody = h('div', { class: 'stack' });
  panel.append(handle, panelBody);
  app.append(
    h('div', { class: 'game' }, [
      h('div', { class: 'topbar' }, [h('span', { class: 'logo', text: 'SimLinPro' }), chips, actions]),
      h('div', { class: 'stage' + (wide ? ' wide-panel' : '') }, [sceneEl, panel]),
    ]),
  );
  const { createWorld } = await import('./scene/world.js');
  const world = createWorld(sceneEl, { mobile, reduced });
  sceneEl.dataset.triangles = String(world.triangles());
  return { chips, actions, tools, panelBody, world, sceneEl };
}

/** Bucle de render con medición de fps. */
function startLoop(frame, onFps) {
  let raf = 0;
  let frames = 0;
  let last = performance.now();
  const tick = () => {
    raf = requestAnimationFrame(tick);
    try {
      frame();
    } catch (e) {
      loggers.forEach((l) => l.error(/** @type {any} */ (e).message, /** @type {any} */ (e).stack));
      throw e;
    }
    frames++;
    const now = performance.now();
    if (now - last >= 1000) {
      onFps((frames * 1000) / (now - last));
      frames = 0;
      last = now;
    }
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

function chip(text, cls = '') {
  return h('span', { class: 'chip ' + cls, text });
}

function clockText(t, days) {
  const d = Math.floor(t / 24);
  const hh = Math.floor(t % 24);
  return `Día ${Math.min(days, d + 1)}/${days} · ${String(hh).padStart(2, '0')}:00`;
}

// ───────────────────────── Anfitrión ─────────────────────────

/**
 * @param {{alias:string, days:number, n:number}} cfg
 * @param {any} [resume]
 * @param {{demoSlot?:string}} [extra]
 */
async function startHost(cfg, resume = null, extra = {}) {
  const demo = !!extra.demoSlot;
  loading('Cargando métricas reales de España…');
  let metrics;
  try {
    metrics = await loadMetrics({ cacheUrl: BASE + 'data/metrics.json' });
  } catch {
    metrics = await loadMetrics({ cacheUrl: BASE + 'data/metrics.json', skipLive: true });
  }
  const room = resume?.room || genCode();
  const days = Math.min(90, Math.max(10, Number(cfg.days) || 40));
  const n = Math.min(5000, Math.max(200, Number(cfg.n) || 1000));
  const engine = resume
    ? Engine.fromState(resume.state)
    : Engine.create({ seed: randomSeed(), days, metrics: toEngineMetrics(metrics) });
  const host = new HostServer({ engine, room });
  const partidaId = resume?.partidaId || `${room}-${engine.state.seed.toString(36)}`;
  const logger = new GameLogger({
    role: 'host',
    sector: null,
    alias: cfg.alias,
    room,
    seed: engine.state.seed,
    config: { velocidad: 1, dias: engine.state.days, nMC: n },
    fuenteDatos: metrics,
    partidaId,
    modo: demo ? 'demo' : 'red',
    mobile,
  });
  loggers.push(logger);
  if (resume?.players) {
    for (const [pid, p] of resume.players)
      host.players.set(pid, {
        alias: p.alias,
        slot: p.slot,
        connId: null,
        disconnectedAt: performance.now(),
      });
  }

  const save = () => {
    if (demo) return;
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          room,
          alias: cfg.alias,
          n,
          partidaId,
          savedAt: Date.now(),
          state: engine.state,
          players: [...host.players.entries()].map(([pid, p]) => [pid, { alias: p.alias, slot: p.slot }]),
        }),
      );
    } catch {
      /* almacenamiento lleno o bloqueado */
    }
  };
  engine.onDayEnd = (day) => {
    logger.kpiDay(day, engine.state.kpiDaily.at(-1).slots);
    save();
  };

  const ui = await gameScreen({ wide: true });
  const { world } = ui;
  host.on('events', (ev) => {
    logger.events(ev);
    world.onEvents(ev);
  });
  host.on('traffic', () => world.traffic());
  host.on('proposal_resolved', (e) => logger.proposal(e));
  host.on('game_over', (summary) => gameOverModal(summary, () => downloadHostLog()));

  /** @type {any} */
  let pool = null;
  const runner = () => {
    if (pool) return pool;
    try {
      const k = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
      pool = workerPool(k);
    } catch {
      pool = localRunner();
    }
    return pool;
  };

  const downloadHostLog = () => {
    logger.parametros = [];
    for (const e of engine.state.paramLog) logger.param(e);
    logger.setRegistro({
      metricas: engine.state.metrics,
      paramLog: engine.state.paramLog,
      controlLog: engine.state.controlLog,
      controladoresIniciales: {},
    });
    logger.setNet({
      rtts: [],
      disconnections: host.netStats.disconnections,
      rejected: host.netStats.rejected,
      received: host.netStats.received,
    });
    logger.o.config.velocidad = host.speed;
    if (engine.state.over) logger.finish();
    logger.download();
  };

  const dash = buildHostDashboard({
    room,
    host,
    engine,
    metrics,
    n,
    demo,
    onStart: () => host.start(),
    onDownloadLog: downloadHostLog,
    onAnalyze: async (slot, N) => {
      const res = await analyzeSlot({
        snapshot: engine.snapshotForMC(),
        slot,
        params: engine.getParams(slot),
        n: N,
        baseSeed: hash32(engine.state.seed, engine.state.t),
        runner: runner(),
      });
      logger.mcMs.push(res.ms);
      return res;
    },
  });

  // Chips y herramientas
  const cRoom = chip(demo ? 'Demo local' : `Sala ${room}`);
  const cClock = chip('');
  const cNet = chip(demo ? 'sin red' : 'conectando…', 'warn');
  const cPlayers = chip('');
  ui.chips.append(cRoom, cClock, cNet, cPlayers);
  ui.tools.append(
    h('button', { class: 'small', text: 'Vista general', onclick: () => world.resetView() }),
    h('button', { class: 'small', text: 'Centrar en la torre', onclick: () => world.focus('host') }),
  );

  // Demo: un cliente local por bucle en memoria, con su HUD y modal de propuestas
  let demoClient = null;
  if (demo) {
    const [a, b] = loopbackPair();
    host.addConnection(a);
    demoClient = await playerSession({
      ui,
      client: new GameClient({ playerId: 'demo-' + randomSeed(), alias: cfg.alias }),
      conn: b,
      slot: extra.demoSlot,
      demo: true,
      room,
      partidaId,
      seed: engine.state.seed,
      days: engine.state.days,
    });
    const mine = demoClient.panel;
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const t1 = h('button', { class: 'on', text: 'Mi puesto' });
    const t2 = h('button', { text: 'Anfitrión' });
    t1.onclick = () => {
      t1.classList.add('on');
      t2.classList.remove('on');
      mine.classList.remove('hidden');
      dash.el.classList.add('hidden');
    };
    t2.onclick = () => {
      t2.classList.add('on');
      t1.classList.remove('on');
      dash.el.classList.remove('hidden');
      mine.classList.add('hidden');
    };
    tabs.append(t1, t2);
    dash.el.classList.add('hidden');
    ui.panelBody.append(tabs, mine, dash.el);
    host.start();
  } else {
    ui.panelBody.append(dash.el);
  }

  // PeerJS: el anfitrión registra simlinpro-CODIGO en PeerJS Cloud
  /** @type {any} */
  let peer = null;
  if (!demo) {
    try {
      const { Peer } = await import('peerjs');
      peer = new Peer(peerIdFor(room), PEER_OPTIONS);
      peer.on('open', () => {
        cNet.textContent = 'servidor listo';
        cNet.className = 'chip ok';
      });
      peer.on('connection', (dc) => dc.on('open', () => host.addConnection(peerConn(dc))));
      peer.on('disconnected', () => {
        cNet.textContent = 'reconectando señalización…';
        cNet.className = 'chip warn';
        try {
          peer.reconnect();
        } catch {
          /* nada */
        }
      });
      peer.on('error', (err) => {
        cNet.textContent = 'error de red';
        cNet.className = 'chip bad';
        toast(describePeerError(err), 8000);
      });
    } catch (e) {
      toast('No se pudo iniciar PeerJS: ' + /** @type {any} */ (e).message);
    }
  }

  const onUnload = (e) => {
    save();
    if (!demo && host.started && !engine.state.over) {
      e.preventDefault();
      e.returnValue = 'Si cierras o recargas, la partida termina para todos (podrás reanudarla).';
    }
  };
  window.addEventListener('beforeunload', onUnload);

  let lastDash = 0;
  const stop = startLoop(
    () => {
      host.update();
      const room2 = host.roomStateMsg();
      const view = buildSnapshotData(engine);
      world.update(view, host.simTime(), {
        speed: host.speed,
        paused: host.paused || !host.started,
        room: room2,
      });
      const now = performance.now();
      if (now - lastDash > 250) {
        lastDash = now;
        dash.update(room2);
        cClock.textContent =
          clockText(host.simTime(), engine.state.days) +
          (host.paused ? ' · en pausa' : host.started ? ` · ×${host.speed}` : ' · esperando inicio');
        cPlayers.innerHTML = `${iconSvg('human', 14)} ${host.connectedCount()} / 9`;
      }
    },
    (fps) => loggers.forEach((l) => l.sampleFps(fps)),
  );

  teardown = () => {
    stop();
    window.removeEventListener('beforeunload', onUnload);
    pool?.terminate();
    peer?.destroy();
    demoClient?.dispose();
    world.dispose();
  };
}

// ───────────────────────── Jugador ─────────────────────────

/**
 * Sesión del jugador sobre una conexión (PeerJS o bucle local). Monta el HUD cuando el anfitrión concede el puesto.
 * @param {{ui:any, client:GameClient, conn?:any, slot?:string, demo?:boolean, room:string, partidaId?:string, seed?:number, days?:number}} o
 */
async function playerSession(o) {
  const { client, ui } = o;
  const world = ui.world;
  const panel = h('div', { class: 'stack' });
  let hud = /** @type {any} */ (null);
  /** @type {GameLogger|null} */
  let logger = null;
  let prevParams = {};
  let lastDay = -1;
  let proposalOpen = /** @type {any} */ (null);

  const pickBox = h('section', { class: 'section' }, [
    h('header', {}, [h('h3', { text: 'Elige tu puesto' })]),
  ]);
  const pickGrid = h('div');
  pickBox.append(
    pickGrid,
    h('p', {
      class: 'tiny muted',
      text: 'Los puestos libres los juega un BOT. Si te desconectas más de 15 s, un BOT toma tu puesto con tus parámetros y lo recuperas al volver.',
    }),
  );
  panel.append(pickBox);

  const feedback = buildFeedback((v, t) => logger?.setFeedback(v, t));

  const downloadLog = () => {
    if (!logger) return toast('Elige un puesto primero.');
    logger.setNet({
      rtts: client.rtts,
      disconnections: client.stats.disconnections,
      rejected: client.stats.rejected,
      received: client.stats.received,
    });
    logger.download();
  };

  client.on('room', (room) => {
    if (!client.slot) {
      pickGrid.innerHTML = '';
      pickGrid.append(slotMap(room, null, (slot) => client.claim(slot)));
    }
  });
  client.on('denied', (m) => toast(m.reason, 5000));
  client.on('granted', (m) => {
    pickBox.remove();
    const ps = /** @type {any} */ (parseSlot(m.slot));
    logger = new GameLogger({
      role: ps.role,
      sector: ps.sector,
      alias: client.alias,
      room: o.room,
      seed: o.seed || 0,
      config: { velocidad: 1, dias: o.days || client.room?.days || 40, nMC: 1000 },
      fuenteDatos: {},
      partidaId: o.partidaId || o.room,
      modo: o.demo ? 'demo' : 'red',
      mobile,
    });
    loggers.push(logger);
    prevParams = { ...m.params };
    const make = { producer: producerHud, distributor: distributorHud, buyer: buyerHud }[ps.role];
    hud?.el.remove();
    hud = make(m.slot, (changes) => client.setParams(changes));
    panel.append(
      hud.el,
      feedback.el,
      h('section', { class: 'section' }, [
        h('header', {}, [h('h3', { text: 'Bitácora' })]),
        h('button', { class: 'ghost', text: 'Descargar bitácora', onclick: downloadLog }),
        h('div', { class: 'tiny muted', text: 'Súbela a la carpeta logs/ del repositorio al terminar.' }),
      ]),
    );
    ui.tools.prepend(
      h('button', {
        class: 'small primary',
        text: 'Centrar en mi puesto',
        onclick: () => world.focus(m.slot),
      }),
    );
    world.focus(m.slot);
    toast(`Juegas como ${ROLE_LABELS[ps.role]} · ${SECTORS[ps.sector].label}`);
  });
  client.on('params', (m) => {
    if (m.slot !== client.slot || !logger) return;
    for (const [k, v] of Object.entries(m.changes)) {
      logger.param({
        t: client.simT,
        slot: m.slot,
        param: k,
        old: prevParams[k] ?? null,
        new: v,
        origin: m.origin,
      });
      prevParams[k] = v;
    }
    if (m.origin === 'jugador') toast('Parámetros aplicados por el anfitrión.', 1800);
  });
  client.on('snapshot', (data) => {
    if (hud) hud.update(data, client.kpiHist);
    const day = data.meta?.day ?? 0;
    if (logger && client.slot && day !== lastDay && data.kpi) {
      lastDay = day;
      if (day > 0) logger.kpiDay(day, data.kpi, client.slot);
    }
    if (!o.demo) world.traffic();
  });
  client.on('events', (ev) => {
    if (!o.demo) world.onEvents(ev);
    logger?.events(ev);
  });
  client.on('proposal', (p) => {
    proposalOpen?.close();
    const t0 = performance.now();
    proposalOpen = showProposal({
      proposal: p,
      onAnswer: (accept) => {
        proposalOpen = null;
        client.answerProposal(p.id, accept);
        logger?.proposal({
          ...p,
          t: client.simT,
          decision: accept ? 'aceptada' : 'rechazada',
          decidedBy: 'jugador',
          responseMs: Math.round(performance.now() - t0),
        });
      },
    });
  });
  client.on('chat', (m) => toast(`${m.from || 'anfitrión'}: ${m.text}`, 5000));
  client.on('log_request', () => {
    toast('El anfitrión pide las bitácoras: se descarga la tuya.', 5000);
    downloadLog();
  });
  client.on('game_over', (summary) => {
    logger?.finish();
    if (!o.demo) gameOverModal(summary, downloadLog, client.slot);
  });

  if (o.conn) client.attach(o.conn);
  if (o.slot) {
    // demo: reclama el puesto en cuanto el anfitrión responda
    setTimeout(() => client.claim(/** @type {string} */ (o.slot)), 0);
  }
  return {
    panel,
    dispose: () => {
      proposalOpen?.close();
      client.close();
    },
  };
}

/** @param {string} code @param {string} alias */
async function startJoin(code, alias) {
  const ui = await gameScreen({});
  const client = new GameClient({ playerId: getPlayerId(), alias });
  const cRoom = chip(`Sala ${code}`);
  const cNet = chip('conectando…', 'warn');
  const cLat = chip('— ms');
  const cClock = chip('');
  ui.chips.append(cRoom, cClock, cNet, cLat);
  ui.tools.append(
    h('button', { class: 'small', text: 'Vista general', onclick: () => ui.world.resetView() }),
  );
  const session = await playerSession({ ui, client, room: code });
  const diag = h('div', { class: 'alert hidden', role: 'alert' });
  ui.panelBody.append(diag, session.panel);
  client.on('status', (s) => {
    cNet.textContent = s.state;
    cNet.className = 'chip ' + (s.state === 'conectado' ? 'ok' : s.state === 'error' ? 'bad' : 'warn');
    if (s.state === 'error') showDiag(s.message);
    if (s.state === 'conectado') diag.classList.add('hidden');
  });
  client.on('latency', (l) => {
    cLat.textContent = `${l.last} ms`;
    cLat.className = 'chip ' + (l.last > 400 ? 'bad' : l.last > 150 ? 'warn' : 'ok');
  });
  function showDiag(message) {
    diag.innerHTML = '';
    diag.append(
      h('b', { text: 'No se pudo conectar. ' }),
      message,
      h('ul', { class: 'tiny' }, [
        h('li', { text: 'Comprueba el código y que el anfitrión tenga la sala abierta.' }),
        h('li', {
          text: 'Las redes de algunos centros bloquean WebRTC (UDP): conecta todos los dispositivos al punto de acceso de un móvil.',
        }),
        h('li', { text: 'Si no hay red, usa el modo demo local.' }),
      ]),
      h('div', { class: 'row' }, [
        h('button', { class: 'small', text: 'Reintentar', onclick: () => connect() }),
        h('button', { class: 'small ghost', text: 'Modo demo local', onclick: () => showLobby() }),
      ]),
    );
    diag.classList.remove('hidden');
  }
  const connect = () =>
    client.connect(code).catch((e) => {
      showDiag(describePeerError(e));
    });
  connect();

  const stop = startLoop(
    () => {
      const t = client.simTime();
      ui.world.update(client.data, t, { speed: client.speed, paused: client.paused, room: client.room });
      if (client.data.meta)
        cClock.textContent = clockText(t, client.data.meta.days) + (client.paused ? ' · en pausa' : '');
    },
    (fps) => loggers.forEach((l) => l.sampleFps(fps)),
  );
  teardown = () => {
    stop();
    session.dispose();
    ui.world.dispose();
  };
}

async function startDemo(slot, alias, o) {
  await startHost({ alias, days: o.days, n: o.n }, null, { demoSlot: slot });
}

// ───────────────────────── Componentes ─────────────────────────

function buildFeedback(onChange) {
  let value = 0;
  const stars = [1, 2, 3, 4, 5].map((v) =>
    h('button', {
      class: 'small ghost',
      text: '★',
      'aria-label': `Valoración ${v} de 5`,
      onclick: () => {
        value = v;
        stars.forEach((s, i) => (s.style.color = i < v ? '#d99a00' : ''));
        onChange(value, text.value);
      },
    }),
  );
  const text = /** @type {HTMLTextAreaElement} */ (
    h('textarea', { rows: 2, maxlength: 2000, placeholder: '¿Qué mejorarías? (opcional)' })
  );
  text.addEventListener('change', () => onChange(value, text.value));
  return {
    el: h('section', { class: 'section' }, [
      h('header', {}, [h('h3', { text: 'Tu valoración' })]),
      h('div', { class: 'row' }, stars),
      text,
    ]),
  };
}

function gameOverModal(summary, onDownload, mySlot = null) {
  const rows = ALL_SLOTS.map((s) => {
    const k = summary.kpi?.[s] || {};
    const p = /** @type {any} */ (parseSlot(s));
    return h('tr', { class: s === mySlot ? 'sel' : '' }, [
      h('td', { text: `${ROLE_LABELS[p.role]} · ${SECTORS[p.sector].label}` }),
      h('td', { text: fmt.eur(k.cash) }),
      h('td', { text: fmt.pct(p.role === 'distributor' ? k.otif : k.fillRate) }),
    ]);
  });
  const back = h('div', { class: 'modal-back', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'modal' }, [
      h('h2', { text: 'Fin de la partida' }),
      h('p', {
        class: 'muted',
        text: `${summary.days} días simulados · ${summary.proposals} propuestas · ${summary.bankruptcies.length} quiebras.`,
      }),
      h('div', { class: 'table-wrap' }, [
        h('table', { class: 'grid' }, [
          h('thead', {}, [
            h(
              'tr',
              {},
              ['Puesto', 'Caja', 'Fill/OTIF'].map((t) => h('th', { text: t })),
            ),
          ]),
          h('tbody', {}, rows),
        ]),
      ]),
      h('p', { class: 'tiny muted', text: 'Valora la partida en el panel antes de descargar tu bitácora.' }),
      h('div', { class: 'row' }, [
        h('button', { class: 'primary grow', text: 'Descargar bitácora', onclick: () => onDownload() }),
        h('button', { class: 'ghost', text: 'Cerrar', onclick: () => back.remove() }),
      ]),
    ]),
  ]);
  document.body.append(back);
}

void SECTOR_IDS;
showLobby();
