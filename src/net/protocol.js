// @ts-check
// Mensajes de red (JSON con `v` = versión de protocolo y `t` = tipo). Esquemas y validación.
// Todo mensaje entrante se valida aquí; lo que no cumple se descarta.
import { PROTOCOL_VERSION, ALL_SLOTS, ALIAS_MAX } from '../config.js';

export const MAX_MESSAGE_BYTES = 256 * 1024;

/**
 * Especificación de campos: tipo y restricciones.
 * str:N = cadena de hasta N caracteres; num = número finito; bool; obj; arr; slot = puesto válido;
 * el sufijo ? marca el campo como opcional.
 */
export const SCHEMAS = {
  hello: { playerId: 'str:64', alias: 'str:' + ALIAS_MAX, appVersion: 'str:20?', host: 'bool?' },
  room_state: { room: 'str:8', slots: 'obj', started: 'bool', speed: 'num', day: 'num', days: 'num' },
  claim_role: { slot: 'slot' },
  role_granted: { slot: 'slot', playerId: 'str:64', params: 'obj' },
  role_denied: { slot: 'str:40', reason: 'str:200' },
  set_params: { changes: 'obj' },
  params_applied: { slot: 'slot', changes: 'obj', origin: 'str:20' },
  snapshot: { simT: 'num', speed: 'num', paused: 'bool', full: 'bool', data: 'obj' },
  event: { events: 'arr' },
  proposal: {
    id: 'str:40',
    slot: 'slot',
    changes: 'obj',
    before: 'obj',
    delta: 'obj',
    pImprove: 'num',
    riskP5: 'num',
    ttlMs: 'num',
    kpiLabel: 'str:60?',
  },
  answer_proposal: { id: 'str:40', accept: 'bool' },
  chat: { text: 'str:300', from: 'str:40?' },
  ping: { ts: 'num' },
  pong: { ts: 'num' },
  game_over: { summary: 'obj' },
  log_request: {},
};

/** Mensajes que un cliente (jugador) puede enviar al anfitrión. */
export const CLIENT_TO_HOST = new Set(['hello', 'claim_role', 'set_params', 'answer_proposal', 'chat', 'ping']);
/** Mensajes que el anfitrión envía a los clientes. */
export const HOST_TO_CLIENT = new Set([
  'room_state',
  'role_granted',
  'role_denied',
  'params_applied',
  'snapshot',
  'event',
  'proposal',
  'chat',
  'pong',
  'game_over',
  'log_request',
]);

/** Construye un mensaje con versión y tipo. */
export function msg(t, body = {}) {
  return { v: PROTOCOL_VERSION, t, ...body };
}

function checkField(spec, value) {
  const optional = spec.endsWith('?');
  const s = optional ? spec.slice(0, -1) : spec;
  if (value === undefined || value === null) return optional;
  const [type, arg] = s.split(':');
  switch (type) {
    case 'str':
      return typeof value === 'string' && value.length <= Number(arg);
    case 'num':
      return typeof value === 'number' && Number.isFinite(value);
    case 'bool':
      return typeof value === 'boolean';
    case 'obj':
      return typeof value === 'object' && !Array.isArray(value);
    case 'arr':
      return Array.isArray(value);
    case 'slot':
      return typeof value === 'string' && ALL_SLOTS.includes(value);
    default:
      return false;
  }
}

/**
 * Valida un mensaje. Devuelve { ok: true, msg } o { ok: false, error }.
 * @param {unknown} raw
 * @param {Set<string>} [allowed] tipos permitidos en este sentido de la comunicación
 */
export function validate(raw, allowed) {
  let m = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_MESSAGE_BYTES) return { ok: false, error: 'mensaje demasiado grande' };
    try {
      m = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'JSON inválido' };
    }
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, error: 'no es un objeto' };
  const o = /** @type {Record<string, any>} */ (m);
  if (o.v !== PROTOCOL_VERSION) return { ok: false, error: 'versión de protocolo distinta' };
  if (typeof o.t !== 'string' || !(o.t in SCHEMAS)) return { ok: false, error: 'tipo desconocido' };
  if (allowed && !allowed.has(o.t)) return { ok: false, error: 'tipo no permitido' };
  const schema = SCHEMAS[o.t];
  for (const [k, spec] of Object.entries(schema)) {
    if (!checkField(spec, o[k])) return { ok: false, error: `campo inválido: ${k}` };
  }
  if (o.t === 'set_params') {
    const n = Object.keys(o.changes).length;
    if (n === 0 || n > 10) return { ok: false, error: 'cambios vacíos o excesivos' };
    for (const v of Object.values(o.changes)) {
      if (!(typeof v === 'number' && Number.isFinite(v)) && !(typeof v === 'string' && v.length <= 10)) {
        return { ok: false, error: 'valor de parámetro inválido' };
      }
    }
  }
  return { ok: true, msg: o };
}

/** Código de sala: 6 caracteres sin ambiguos (sin 0/O/1/I). */
export function isValidRoomCode(code) {
  return typeof code === 'string' && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code);
}

export function peerIdFor(code) {
  return 'simlinpro-' + code;
}

/** Limpia el alias: sin saltos de línea ni caracteres de control, hasta 20 caracteres. */
export function sanitizeAlias(alias) {
  return (
    String(alias || '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f<>]/g, '')
      .trim()
      .slice(0, ALIAS_MAX) || 'anónimo'
  );
}
