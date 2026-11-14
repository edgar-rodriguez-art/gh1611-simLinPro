// @ts-check
// JSON Schema de la bitácora (§10.1) y un validador mínimo sin dependencias (lo usa también analyze-logs.mjs).
import { LOG_SCHEMA_VERSION } from '../config.js';

export const MAX_LOG_BYTES = 2 * 1024 * 1024;

const num = { type: 'number' };
const str = (maxLength = 200) => ({ type: 'string', maxLength });
const nullableNum = { type: ['number', 'null'] };

export const LOG_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://edgar-rodriguez-art.github.io/gh1611-simLinPro/schema/bitacora.json',
  title: 'Bitácora de partida SimLinPro',
  type: 'object',
  required: [
    'schemaVersion',
    'appVersion',
    'commitSha',
    'partidaId',
    'sala',
    'rol',
    'sector',
    'alias',
    'semilla',
    'config',
    'fuenteDatos',
    'inicio',
    'fin',
    'parametros',
    'propuestas',
    'kpiDiarios',
    'eventos',
    'red',
    'rendimiento',
    'errores',
    'feedback',
  ],
  properties: {
    schemaVersion: { type: 'integer', enum: [LOG_SCHEMA_VERSION] },
    appVersion: str(20),
    commitSha: str(40),
    partidaId: str(80),
    sala: { type: 'string', maxLength: 6, minLength: 4 },
    rol: { type: 'string', enum: ['anfitrion', 'productor', 'distribuidor', 'comprador'] },
    sector: { type: ['string', 'null'], enum: ['panaderia', 'textil', 'electronica', null] },
    alias: str(20),
    semilla: { type: 'integer', minimum: 0 },
    modo: { type: 'string', enum: ['red', 'demo'] },
    config: {
      type: 'object',
      required: ['velocidad', 'dias', 'nMC'],
      properties: { velocidad: num, dias: { type: 'integer', minimum: 1 }, nMC: { type: 'integer', minimum: 1 } },
    },
    fuenteDatos: { type: 'object' },
    inicio: str(40),
    fin: { type: ['string', 'null'], maxLength: 40 },
    parametros: {
      type: 'array',
      items: {
        type: 'object',
        required: ['t', 'puesto', 'parametro', 'anterior', 'nuevo', 'origen'],
        properties: {
          t: num,
          puesto: str(40),
          parametro: str(40),
          anterior: { type: ['number', 'string', 'null'] },
          nuevo: { type: ['number', 'string', 'null'] },
          origen: { type: 'string', enum: ['jugador', 'propuesta', 'bot', 'anfitrion'] },
        },
      },
    },
    propuestas: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'puesto', 'cambios', 'deltaEsperada', 'pMejora', 'decision'],
        properties: {
          id: str(40),
          t: num,
          puesto: str(40),
          cambios: { type: 'object' },
          anterior: { type: 'object' },
          deltaEsperada: { type: 'object' },
          pMejora: { type: 'number', minimum: 0, maximum: 1 },
          riesgoP5: num,
          decision: { type: 'string', enum: ['aceptada', 'rechazada', 'expirada', 'pendiente'] },
          decididoPor: { type: 'string', enum: ['jugador', 'bot'] },
          tiempoRespuestaMs: nullableNum,
        },
      },
    },
    kpiDiarios: {
      type: 'array',
      items: { type: 'object', required: ['dia'], properties: { dia: { type: 'integer', minimum: 0 } } },
    },
    eventos: {
      type: 'array',
      items: { type: 'object', required: ['t', 'tipo'], properties: { t: num, tipo: str(40) } },
    },
    red: {
      type: 'object',
      required: ['latenciaP50', 'latenciaP95', 'desconexiones', 'mensajesRechazados', 'mensajesRecibidos'],
      properties: {
        latenciaP50: nullableNum,
        latenciaP95: nullableNum,
        desconexiones: { type: 'integer', minimum: 0 },
        mensajesRechazados: { type: 'integer', minimum: 0 },
        mensajesRecibidos: { type: 'integer', minimum: 0 },
      },
    },
    rendimiento: {
      type: 'object',
      required: ['fpsMedio', 'fpsMin', 'mcMs', 'dispositivo'],
      properties: {
        fpsMedio: nullableNum,
        fpsMin: nullableNum,
        mcMs: { type: 'array', items: num },
        dispositivo: { type: 'string', enum: ['movil', 'escritorio'] },
      },
    },
    errores: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        required: ['mensaje', 't'],
        properties: { mensaje: str(500), stack: str(2000), t: str(40), fatal: { type: 'boolean' } },
      },
    },
    feedback: {
      type: 'object',
      properties: {
        valoracion: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
        texto: { type: 'string', maxLength: 2000 },
      },
    },
    registro: {
      type: 'object',
      description: 'Solo en la bitácora del anfitrión: datos para reproducir la partida.',
      required: ['metricas', 'paramLog', 'controlLog', 'controladoresIniciales'],
      properties: {
        metricas: { type: 'object' },
        paramLog: { type: 'array' },
        controlLog: { type: 'array' },
        controladoresIniciales: { type: 'object' },
      },
    },
  },
};

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(expected, v) {
  const t = typeOf(v);
  const list = Array.isArray(expected) ? expected : [expected];
  return list.some((e) => e === t || (e === 'number' && t === 'integer'));
}

/**
 * Validador mínimo de JSON Schema (type, required, properties, items, enum, minimum, maximum,
 * minLength, maxLength, maxItems). Devuelve la lista de errores (vacía si es válido).
 */
export function validateSchema(schema, value, path = '$', errors = []) {
  if (errors.length > 50) return errors;
  if (schema.type && !typeMatches(schema.type, value)) {
    errors.push(`${path}: se esperaba ${schema.type}, llegó ${typeOf(value)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: valor fuera de la lista (${JSON.stringify(value)})`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: menor que ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: mayor que ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: texto demasiado largo`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: texto demasiado corto`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: demasiados elementos`);
    if (schema.items) value.forEach((v, i) => validateSchema(schema.items, v, `${path}[${i}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required || []) if (!(k in value)) errors.push(`${path}: falta "${k}"`);
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      if (k in value) validateSchema(sub, value[k], `${path}.${k}`, errors);
    }
  }
  return errors;
}

export function validateLog(log) {
  return validateSchema(LOG_SCHEMA, log);
}
