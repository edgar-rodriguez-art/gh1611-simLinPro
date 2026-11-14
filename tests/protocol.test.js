import { describe, it, expect } from 'vitest';
import { validate, msg, CLIENT_TO_HOST, isValidRoomCode, sanitizeAlias } from '../src/net/protocol.js';

describe('protocolo', () => {
  it('acepta mensajes válidos', () => {
    expect(validate(msg('hello', { playerId: 'p1', alias: 'Ana' }), CLIENT_TO_HOST).ok).toBe(true);
    expect(validate(JSON.stringify(msg('claim_role', { slot: 'producer-textile' })), CLIENT_TO_HOST).ok).toBe(true);
    expect(validate(msg('set_params', { changes: { shifts: 3, supplier: 'A' } }), CLIENT_TO_HOST).ok).toBe(true);
  });
  it('rechaza mensajes inválidos', () => {
    expect(validate('no json', CLIENT_TO_HOST).ok).toBe(false);
    expect(validate({ t: 'hello', playerId: 'x', alias: 'y' }).ok).toBe(false); // sin versión
    expect(validate(msg('nope', {})).ok).toBe(false);
    expect(validate(msg('claim_role', { slot: 'jefe-total' }), CLIENT_TO_HOST).ok).toBe(false);
    expect(validate(msg('hello', { playerId: 'p', alias: 'x'.repeat(50) }), CLIENT_TO_HOST).ok).toBe(false);
    expect(validate(msg('set_params', { changes: {} }), CLIENT_TO_HOST).ok).toBe(false);
    expect(validate(msg('set_params', { changes: { a: { b: 1 } } }), CLIENT_TO_HOST).ok).toBe(false);
    expect(validate(msg('set_params', { changes: { a: Infinity } }), CLIENT_TO_HOST).ok).toBe(false);
    // un cliente no puede enviar snapshots
    expect(validate(msg('snapshot', { simT: 1, speed: 1, paused: false, full: true, data: {} }), CLIENT_TO_HOST).ok).toBe(
      false,
    );
  });
  it('códigos de sala sin caracteres ambiguos', () => {
    expect(isValidRoomCode('K7P2QX')).toBe(true);
    expect(isValidRoomCode('K7P2Q0')).toBe(false);
    expect(isValidRoomCode('KIP2QX')).toBe(false);
  });
  it('limpia el alias', () => {
    expect(sanitizeAlias('  <b>Ana</b>\n ')).toBe('bAna/b');
    expect(sanitizeAlias('')).toBe('anónimo');
  });
});
