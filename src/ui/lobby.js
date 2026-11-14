// @ts-check
// Lobby: crear sala (anfitrión), unirse con código, modo demo local y mapa de puestos.
import { h } from './dom.js';
import { iconSvg } from './icons.js';
import { SECTOR_IDS, ROLE_IDS, SECTORS, ROLE_LABELS, DEFAULT_DAYS, DAYS_RANGE, MC_DEFAULT_N, MC_N_RANGE, slotId, ALIAS_MAX } from '../config.js';
import { isValidRoomCode } from '../net/protocol.js';
import { appVersion, commitSha } from '../log/logger.js';

export function footer() {
  return h('div', { class: 'footer' }, [
    `SimLinPro v${appVersion()} · commit ${commitSha().slice(0, 7)} · `,
    h('a', { href: 'https://github.com/edgar-rodriguez-art/gh1611-simLinPro', target: '_blank', rel: 'noopener', text: 'código fuente' }),
    ' · Datos: Eurostat y Banco Mundial (España)',
  ]);
}

/**
 * @param {HTMLElement} root
 * @param {{onCreate:(o:any)=>void, onJoin:(code:string, alias:string)=>void, onDemo:(slot:string, alias:string, o:any)=>void,
 *          saved?:any, onResume?:()=>void, prefillCode?:string, message?:string}} o
 */
export function renderLobby(root, o) {
  root.innerHTML = '';
  const aliasField = (id) =>
    h('label', { class: 'field' }, [
      'Alias (sin datos personales)',
      h('input', { type: 'text', id, maxlength: ALIAS_MAX, placeholder: 'p. ej. Ana', autocomplete: 'off' }),
    ]);
  const val = (id) => /** @type {HTMLInputElement} */ (root.querySelector('#' + id)).value.trim();

  const createCard = h('section', { class: 'card stack' }, [
    h('h2', { html: `${iconSvg('host', 20, '#5b3fb8')} Crear sala (anfitrión)` }),
    h('p', { class: 'muted', text: 'Tu navegador será el servidor de la partida. Proyecta esta pantalla en clase.' }),
    aliasField('host-alias'),
    h('div', { class: 'row' }, [
      h('label', { class: 'field grow' }, [
        'Días simulados',
        h('input', { type: 'number', id: 'host-days', min: DAYS_RANGE[0], max: DAYS_RANGE[1], value: DEFAULT_DAYS }),
      ]),
      h('label', { class: 'field grow' }, [
        'Réplicas Monte Carlo (N)',
        h('input', { type: 'number', id: 'host-n', min: MC_N_RANGE[0], max: MC_N_RANGE[1], step: 100, value: MC_DEFAULT_N }),
      ]),
    ]),
    h('button', {
      class: 'primary',
      text: 'Crear sala',
      onclick: () =>
        o.onCreate({ alias: val('host-alias') || 'anfitrion', days: Number(val('host-days')), n: Number(val('host-n')) }),
    }),
    o.saved
      ? h('div', { class: 'alert' }, [
          `Hay una partida guardada de la sala ${o.saved.room} (día ${Math.floor(o.saved.state.t / 24)}). `,
          h('button', { class: 'small', text: 'Reanudar', onclick: () => o.onResume && o.onResume() }),
        ])
      : null,
  ]);

  const joinCard = h('section', { class: 'card stack' }, [
    h('h2', { html: `${iconSvg('human', 20, '#1f9d55')} Unirse con código` }),
    h('p', { class: 'muted', text: 'Escribe el código de 6 caracteres que muestra el anfitrión o escanea su QR.' }),
    h('label', { class: 'field' }, [
      'Código de sala',
      h('input', {
        type: 'text',
        id: 'join-code',
        class: 'code-input',
        maxlength: 6,
        value: o.prefillCode || '',
        autocomplete: 'off',
        autocapitalize: 'characters',
        spellcheck: 'false',
      }),
    ]),
    aliasField('join-alias'),
    h('button', {
      class: 'ok',
      text: 'Unirse',
      onclick: () => {
        const code = val('join-code').toUpperCase();
        const err = /** @type {HTMLElement} */ (root.querySelector('#join-error'));
        if (!isValidRoomCode(code)) {
          err.textContent = 'El código tiene 6 caracteres (letras y números, sin 0, O, 1 ni I).';
          err.classList.remove('hidden');
          return;
        }
        o.onJoin(code, val('join-alias') || 'jugador');
      },
    }),
    h('div', { id: 'join-error', class: 'alert error hidden', role: 'alert' }),
  ]);

  const demoSelect = h(
    'select',
    { id: 'demo-slot' },
    ROLE_IDS.flatMap((r) => SECTOR_IDS.map((s) => h('option', { value: slotId(r, s), text: `${ROLE_LABELS[r]} · ${SECTORS[s].label}` }))),
  );
  const demoCard = h('section', { class: 'card stack' }, [
    h('h2', { html: `${iconSvg('bot', 20, '#6b6585')} Modo demo local` }),
    h('p', { class: 'muted', text: 'Todo en este dispositivo: eliges un puesto y los demás los juegan BOT. Sirve sin red.' }),
    aliasField('demo-alias'),
    h('label', { class: 'field' }, ['Tu puesto', demoSelect]),
    h('button', {
      text: 'Probar demo',
      onclick: () =>
        o.onDemo(/** @type {HTMLSelectElement} */ (demoSelect).value, val('demo-alias') || 'demo', { days: DEFAULT_DAYS, n: MC_DEFAULT_N }),
    }),
  ]);

  root.append(
    h('main', { class: 'lobby' }, [
      h('div', { class: 'brand' }, [h('h1', { text: 'SimLinPro' }), h('span', { class: 'sub', text: 'Simulación low-poly de líneas de producción' })]),
      h('p', {
        class: 'lead',
        text: 'Cadena de suministro en tiempo real con tres sectores (panadería, textil y electrónica). Proveedor → Productor → Distribuidor → Comprador. El anfitrión analiza con Monte Carlo y datos reales de España, y propone mejoras que cada jugador acepta o rechaza.',
      }),
      o.message ? h('div', { class: 'alert error', role: 'alert', text: o.message }) : null,
      h('div', { class: 'cards' }, [createCard, joinCard, demoCard]),
      h('section', { class: 'card', style: { marginTop: '16px' } }, [
        h('h3', { text: 'Cómo se juega' }),
        h('ol', { class: 'muted' }, [
          h('li', { text: 'El docente crea la sala y proyecta la escena. Los jugadores entran con el código o el QR desde el móvil.' }),
          h('li', { text: 'Cada jugador elige un puesto (productor, distribuidor o comprador de un sector). Los puestos libres los juega un BOT.' }),
          h('li', { text: 'Ajusta tus parámetros en tiempo real: turnos, lotes, precios, camiones, stock de seguridad…' }),
          h('li', { text: 'El anfitrión ejecuta Monte Carlo y te envía propuestas: acéptalas o recházalas en 90 s.' }),
          h('li', { text: 'Al final, descarga tu bitácora y súbela a la carpeta logs/ del repositorio para mejorar el juego.' }),
        ]),
      ]),
      footer(),
    ]),
  );
}

/**
 * Mapa de puestos (3 roles × 3 sectores) con quién ocupa cada uno.
 * @param {any} room mensaje room_state
 * @param {string|null} mySlot
 * @param {((slot:string)=>void)|null} onPick
 */
export function slotMap(room, mySlot, onPick) {
  const grid = h('div', { class: 'slots' });
  for (const r of ROLE_IDS) grid.append(h('div', { class: 'slot-col-title', text: ROLE_LABELS[r] }));
  for (const s of SECTOR_IDS) {
    for (const r of ROLE_IDS) {
      const slot = slotId(r, s);
      const info = room?.slots?.[slot] || {};
      const taken = !!info.alias && slot !== mySlot;
      const who = info.alias
        ? `${iconSvg('human', 14)} ${escapeHtml(info.alias)}${info.connected ? '' : ' (desconectado)'}`
        : `${iconSvg('bot', 14)} BOT`;
      const btn = h(
        'button',
        {
          class: `slot ${taken ? 'taken' : ''} ${slot === mySlot ? 'mine' : ''}`,
          'data-sector': s,
          disabled: !onPick || taken ? true : undefined,
          onclick: () => onPick && onPick(slot),
          'aria-label': `${ROLE_LABELS[r]} ${SECTORS[s].label}: ${info.alias ? 'ocupado por ' + info.alias : 'libre (BOT)'}`,
        },
        [h('span', { text: SECTORS[s].label }), h('span', { class: 'who', html: who })],
      );
      grid.append(btn);
    }
  }
  return grid;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
}
