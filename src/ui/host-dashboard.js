// @ts-check
// Panel del anfitrión: sala y QR, velocidad, KPI de todos, datos de España, Monte Carlo, propuestas y bitácoras.
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import qrcode from 'qrcode-generator';
import { h, fmt, toast } from './dom.js';
import { slotMap } from './lobby.js';
import { iconSvg } from './icons.js';
import { paramValueLabel } from './proposal-modal.js';
import { ALL_SLOTS, SECTOR_IDS, SECTORS, ROLE_LABELS, SPEEDS, PARAM_DEFS, MC_N_RANGE, parseSlot } from '../config.js';
import { ROLE_KPIS } from '../sim/montecarlo.js';

const SLOT_COLORS = { bakery: '#d2553a', textile: '#8e6fd1', electronics: '#2f80d1' };

export function joinUrl(room) {
  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  return `${base}?sala=${room}`;
}

/**
 * @param {{room:string, host:any, engine:any, metrics:any, n:number, demo?:boolean,
 *          onAnalyze:(slot:string, n:number)=>Promise<any>, onDownloadLog:()=>void, onStart:()=>void}} o
 */
export function buildHostDashboard(o) {
  const root = h('div', { class: 'stack' });

  // ───── Sala ─────
  const qr = qrcode(0, 'M');
  qr.addData(joinUrl(o.room));
  qr.make();
  const qrBox = h('div', { class: 'qr', html: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) });
  const slotsBox = h('div');
  const startBtn = h('button', { class: 'primary', text: 'Iniciar partida', onclick: () => o.onStart() });
  const speedSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Velocidad' });
  const speedBtns = SPEEDS.map((s) =>
    h('button', { type: 'button', text: '×' + String(s).replace('.', ','), onclick: () => o.host.setSpeed(s) }),
  );
  speedSeg.append(...speedBtns);
  const pauseBtn = h('button', { class: 'ghost small', text: 'Pausa de emergencia', onclick: () => o.host.setPaused(!o.host.paused) });
  root.append(
    h('section', { class: 'section' }, [
      h('header', {}, [h('h3', { text: o.demo ? 'Modo demo local' : 'Sala' }), h('span', { class: 'room-code', text: o.room })]),
      o.demo
        ? h('p', { class: 'muted tiny', text: 'Todo corre en este dispositivo. Los puestos que no son tuyos los juegan BOT.' })
        : h('div', { class: 'row' }, [
            qrBox,
            h('div', { class: 'grow stack tiny' }, [
              h('span', { class: 'muted', text: 'Los jugadores entran escaneando el QR o con el código en:' }),
              h('code', { text: joinUrl(o.room).replace(/\?.*/, '') }),
            ]),
          ]),
      slotsBox,
      h('div', { class: 'row' }, [startBtn, h('span', { class: 'grow' }), pauseBtn]),
      h('div', { class: 'param' }, [h('div', { class: 'top' }, [h('span', { text: 'Velocidad (1 día = 60 s con ×1)' })]), speedSeg]),
    ]),
  );

  // ───── KPI de todos ─────
  const kpiBody = h('tbody');
  const cashChartBox = h('div', { class: 'hist' });
  root.append(
    h('section', { class: 'section' }, [
      h('header', {}, [h('h3', { text: 'KPI de todos los puestos (último día)' })]),
      h('div', { class: 'table-wrap' }, [
        h('table', { class: 'grid' }, [
          h('thead', {}, [
            h('tr', {}, ['Puesto', 'Caja', 'Margen', 'KPI clave', 'Fill/OTIF', 'Lead P95', 'Látigo'].map((t) => h('th', { text: t }))),
          ]),
          kpiBody,
        ]),
      ]),
      h('div', { class: 'tiny muted', text: 'Caja por puesto (EUR)' }),
      cashChartBox,
    ]),
  );

  // ───── Datos de España ─────
  const dataBox = h('div', { class: 'tiny stack' });
  root.append(h('section', { class: 'section' }, [h('header', {}, [h('h3', { text: 'Datos reales de España' })]), dataBox]));
  renderData(dataBox, o.metrics);

  // ───── Monte Carlo ─────
  const mcSlot = /** @type {HTMLSelectElement} */ (
    h(
      'select',
      { 'aria-label': 'Puesto a analizar' },
      ALL_SLOTS.map((s) => {
        const p = /** @type {any} */ (parseSlot(s));
        return h('option', { value: s, text: `${ROLE_LABELS[p.role]} · ${SECTORS[p.sector].label}` });
      }),
    )
  );
  const mcN = /** @type {HTMLInputElement} */ (
    h('input', { type: 'number', min: MC_N_RANGE[0], max: MC_N_RANGE[1], step: 100, value: o.n, 'aria-label': 'Réplicas N' })
  );
  const mcBtn = h('button', { class: 'primary', text: 'Analizar' });
  const mcInfo = h('div', { class: 'tiny muted', text: 'Simula 14 días desde el estado actual: línea base frente a variaciones de ±10 % y ±20 % de cada parámetro.' });
  const histBox = h('div', { class: 'hist' });
  const rankBox = h('div', { class: 'table-wrap' });
  mcBtn.addEventListener('click', async () => {
    mcBtn.setAttribute('disabled', '');
    mcInfo.textContent = 'Calculando…';
    try {
      const n = Math.min(MC_N_RANGE[1], Math.max(MC_N_RANGE[0], Number(mcN.value) || o.n));
      const res = await o.onAnalyze(mcSlot.value, n);
      renderMc(res);
    } catch (e) {
      mcInfo.textContent = 'Error en Monte Carlo: ' + (e && e.message ? e.message : e);
    } finally {
      mcBtn.removeAttribute('disabled');
    }
  });
  root.append(
    h('section', { class: 'section' }, [
      h('header', {}, [h('h3', { text: 'Monte Carlo y propuestas' })]),
      h('div', { class: 'row' }, [h('div', { class: 'grow' }, [mcSlot]), h('div', { style: { width: '96px' } }, [mcN]), mcBtn]),
      mcInfo,
      histBox,
      rankBox,
    ]),
  );

  // ───── Propuestas y bitácoras ─────
  const propList = h('div', { class: 'tiny stack' }, [h('span', { class: 'muted', text: 'Aún no hay propuestas.' })]);
  const chat = h('div', { class: 'chat-log' });
  root.append(
    h('section', { class: 'section' }, [h('header', {}, [h('h3', { text: 'Historial de propuestas' })]), propList]),
    h('section', { class: 'section' }, [
      h('header', {}, [h('h3', { text: 'Bitácoras' })]),
      h('div', { class: 'row' }, [
        o.demo ? null : h('button', { text: 'Pedir bitácoras a todos', onclick: () => (o.host.requestLogs(), toast('Petición enviada a todos los jugadores.')) }),
        h('button', { class: 'ghost', text: 'Descargar bitácora del anfitrión', onclick: () => o.onDownloadLog() }),
      ]),
      h('div', { class: 'tiny muted', text: 'Sube los .json a la carpeta logs/ del repositorio (ver logs/README.md).' }),
    ]),
    h('section', { class: 'section' }, [h('header', {}, [h('h3', { text: 'Mensajes' })]), chat]),
  );

  o.host.on('proposal_resolved', (e) => {
    if (propList.firstChild && propList.firstChild.textContent?.startsWith('Aún')) propList.innerHTML = '';
    const p = /** @type {any} */ (parseSlot(e.slot));
    const ch = Object.entries(e.changes).map(([k, v]) => `${PARAM_DEFS[p.role][k]?.label || k}: ${paramValueLabel(k, e.before[k])} → ${paramValueLabel(k, v)}`).join(', ');
    const cls = e.decision === 'aceptada' ? 'ok' : e.decision === 'expirada' ? 'warn' : 'bad';
    propList.prepend(
      h('div', { class: 'row' }, [
        h('span', { class: 'chip ' + cls, text: e.decision }),
        h('span', { class: 'grow', text: `${ROLE_LABELS[p.role]} ${SECTORS[p.sector].label} (${e.decidedBy}): ${ch}` }),
      ]),
    );
    toast(`Propuesta ${e.decision} por ${ROLE_LABELS[p.role]} · ${SECTORS[p.sector].label}`);
  });
  o.host.on('chat', (e) => chat.append(h('div', { text: `${e.from}: ${e.text}` })));

  // ───── Monte Carlo: render ─────
  /** @type {uPlot|null} */
  let histPlot = null;
  function renderMc(res) {
    const p = /** @type {any} */ (parseSlot(res.slot));
    const kd = ROLE_KPIS[p.role];
    mcInfo.innerHTML = '';
    mcInfo.append(
      `${res.ranking.length} candidatos · N = ${res.nUsed} réplicas en la etapa final · ${(res.ms / 1000).toFixed(1)} s. `,
      `Beneficio base a 14 días: P5 ${fmt.eur(res.baseline.p5)} · P50 ${fmt.eur(res.baseline.p50)} · P95 ${fmt.eur(res.baseline.p95)}.`,
    );
    if (res.reduced)
      mcInfo.append(h('div', { class: 'alert', text: `Se redujo N de ${res.nRequested} a ${res.nUsed} para no superar 3 s en este equipo.` }));
    // Histograma: base frente al mejor candidato
    histBox.innerHTML = '';
    if (res.hist && res.hist.edges.length) {
      const data = [res.hist.edges, res.hist.a, res.hist.b];
      const width = Math.max(260, histBox.clientWidth || 340);
      histPlot?.destroy();
      histPlot = new uPlot(
        {
          width,
          height: 170,
          legend: { show: true },
          scales: { x: { time: false } },
          axes: [{ values: (u, v) => v.map((x) => fmt.eur(x)), size: 30, font: '10px system-ui' }, { size: 34, font: '10px system-ui' }],
          series: [
            { label: 'Beneficio 14 d' },
            { label: 'Base', stroke: '#8a86a3', fill: 'rgba(138,134,163,0.35)', paths: uPlot.paths.bars({ size: [0.9, 30] }), points: { show: false } },
            { label: 'Mejor', stroke: '#5b3fb8', fill: 'rgba(91,63,184,0.45)', paths: uPlot.paths.bars({ size: [0.9, 30] }), points: { show: false } },
          ],
        },
        /** @type {any} */ (data),
        histBox,
      );
    }
    // Ranking
    const fmtK = (def, x) => (def.fmt === 'pct' ? fmt.signed(x * 100, fmt.num) + ' pp' : fmt.signed(x));
    const rows = res.ranking.slice(0, 12).map((c, i) => {
      const s = c.stats;
      const label = Object.entries(c.changes)
        .map(([k, v]) => `${PARAM_DEFS[p.role][k]?.label || k}: ${paramValueLabel(k, v)}`)
        .join(' + ');
      const btn = h('button', {
        class: 'small ' + (s.deltaProfit > 0 ? 'ok' : 'ghost'),
        text: 'Enviar',
        onclick: () => {
          o.host.sendProposal({
            slot: res.slot,
            changes: c.changes,
            delta: { profit: Math.round(s.deltaProfit * 100) / 100, k1: s.deltaK1, k2: s.deltaK2 },
            pImprove: s.pImprove,
            riskP5: s.riskP5,
            kpiLabel: `N = ${c.n}`,
          });
          btn.setAttribute('disabled', '');
          btn.textContent = 'Enviada';
          toast('Propuesta enviada.');
        },
      });
      return h('tr', { class: i === 0 ? 'sel' : '' }, [
        h('td', { text: label, title: `N = ${c.n}` }),
        h('td', { class: s.deltaProfit >= 0 ? 'pos' : 'neg', text: fmt.signed(s.deltaProfit, fmt.eur) }),
        h('td', { text: fmtK(kd[0], s.deltaK1) }),
        h('td', { text: fmtK(kd[1], s.deltaK2) }),
        h('td', { text: fmt.pct(s.pImprove) }),
        h('td', { class: s.riskP5 > 0.05 ? 'neg' : '', text: s.riskP5 > 0 ? fmt.pct(s.riskP5) : '—' }),
        h('td', {}, [btn]),
      ]);
    });
    rankBox.innerHTML = '';
    rankBox.append(
      h('table', { class: 'grid' }, [
        h('thead', {}, [
          h('tr', {}, ['Candidato', 'Δ beneficio', 'Δ ' + kd[0].label, 'Δ ' + kd[1].label, 'P(mejora)', 'Riesgo P5', ''].map((t) => h('th', { text: t }))),
        ]),
        h('tbody', {}, rows),
      ]),
      h('div', { class: 'tiny muted', text: 'Tú eliges qué propuesta enviar; nunca se envía sola. Un BOT acepta si P(mejora) ≥ 60 % y el riesgo P5 ≤ 5 %.' }),
    );
  }

  // ───── Actualización periódica ─────
  /** @type {uPlot|null} */
  let cashPlot = null;
  let lastDay = -1;
  let lastRoom = '';
  return {
    el: root,
    renderMc,
    update(room) {
      const eng = o.engine;
      const day = Math.floor(eng.state.t / 24);
      const roomKey = JSON.stringify(room?.slots || {}) + o.host.started;
      if (roomKey !== lastRoom) {
        lastRoom = roomKey;
        slotsBox.innerHTML = '';
        slotsBox.append(slotMap(room, null, null));
        startBtn.classList.toggle('hidden', o.host.started);
      }
      speedBtns.forEach((b, i) => b.classList.toggle('on', SPEEDS[i] === o.host.speed));
      pauseBtn.textContent = o.host.paused ? 'Reanudar' : 'Pausa de emergencia';
      if (day === lastDay) return;
      lastDay = day;
      const last = eng.state.kpiDaily.at(-1)?.slots;
      kpiBody.innerHTML = '';
      for (const slot of ALL_SLOTS) {
        const p = /** @type {any} */ (parseSlot(slot));
        const k = last?.[slot] || {};
        const ctl = eng.state.slots[slot];
        const main = p.role === 'producer' ? ['OEE', k.oee] : p.role === 'distributor' ? ['Util.', k.fleetUtil] : ['Perdidas', k.lost];
        kpiBody.append(
          h('tr', {}, [
            h('td', {
              html: `<span class="dot" style="background:${SLOT_COLORS[p.sector]}"></span>${iconSvg(ctl.controller === 'human' ? 'human' : 'bot', 12)} ${ROLE_LABELS[p.role].slice(0, 5)}. ${SECTORS[p.sector].label}`,
            }),
            h('td', { class: k.cash < 0 ? 'neg' : '', text: fmt.eur(k.cash) }),
            h('td', { class: k.margin < 0 ? 'neg' : 'pos', text: fmt.eur(k.margin) }),
            h('td', { text: main[1] === undefined ? '—' : p.role === 'buyer' ? fmt.int(main[1]) : `${main[0]} ${fmt.pct(main[1])}` }),
            h('td', { text: fmt.pct(p.role === 'distributor' ? k.otif : k.fillRate) }),
            h('td', { text: p.role === 'distributor' ? fmt.hours(k.leadP95) : '—' }),
            h('td', { text: fmt.num(k.bullwhip) }),
          ]),
        );
      }
      // Gráfica de caja
      const hist = eng.state.kpiDaily;
      if (hist.length >= 2) {
        const data = [hist.map((d) => d.day), ...ALL_SLOTS.map((s) => hist.map((d) => d.slots[s].cash))];
        if (!cashPlot) {
          cashPlot = new uPlot(
            {
              width: Math.max(260, cashChartBox.clientWidth || 340),
              height: 160,
              legend: { show: false },
              scales: { x: { time: false } },
              axes: [{ size: 24, font: '10px system-ui' }, { size: 44, font: '10px system-ui', values: (u, v) => v.map((x) => (Math.abs(x) >= 1000 ? Math.round(x / 1000) + 'k' : x)) }],
              series: [
                { label: 'Día' },
                ...ALL_SLOTS.map((s) => {
                  const p = /** @type {any} */ (parseSlot(s));
                  return { label: s, stroke: SLOT_COLORS[p.sector], width: 1.5, dash: p.role === 'producer' ? undefined : p.role === 'distributor' ? [6, 3] : [2, 3] };
                }),
              ],
            },
            /** @type {any} */ (data),
            cashChartBox,
          );
        } else cashPlot.setData(/** @type {any} */ (data));
      }
    },
  };
}

function renderData(box, m) {
  box.innerHTML = '';
  if (!m) return;
  box.append(h('div', {}, [h('b', { text: 'Fuente: ' }), m.fuente, ` · consultado ${m.fecha}`, m.cacheFecha ? ` · caché ${String(m.cacheFecha).slice(0, 10)}` : '']));
  for (const s of SECTOR_IDS) {
    const x = m.sectors[s];
    box.append(
      h('div', {
        text: `${SECTORS[s].label} (${SECTORS[s].eurostatNace}): índice ${fmt.num(x.index)} · volatilidad ${fmt.pct(x.sigma)} · periodo ${x.period || '—'} · ${x.fuente}${x.via === 'cache' ? ' (caché)' : ''}${x.s_adj ? ' · ' + x.s_adj : ''}`,
      }),
    );
  }
  box.append(
    h('div', {
      text: `Inflación (IPCA/IPC): ${fmt.num(m.hicp.rate)} % · periodo ${m.hicp.period || '—'} · ${m.hicp.fuente}${m.hicp.via === 'cache' ? ' (caché)' : ''}${m.hicp.stale ? ' · ¡serie desactualizada!' : ''}`,
    }),
  );
  box.append(h('div', { class: 'muted', text: 'λ sector = λ base × índice / 100 · costo de insumos × (1 + IPCA/12) cada 30 días.' }));
}
