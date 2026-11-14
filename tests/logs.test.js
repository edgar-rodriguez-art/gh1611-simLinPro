import { describe, it, expect } from 'vitest';
import { slugAlias, compactIfNeeded } from '../src/log/logger.js';
import { playGame } from './helpers/game.js';
import { validateLog } from '../src/log/schema.js';
import { analyze } from '../scripts/analyze-logs.mjs';

describe('bitácoras', () => {
  it('la bitácora generada valida contra el esquema', () => {
    const { host, player } = playGame();
    expect(validateLog(host.build())).toEqual([]);
    expect(validateLog(player.build())).toEqual([]);
  });
  it('nombre de archivo AAAA-MM-DD_SALA_rol-sector_alias.json', () => {
    const { host, player } = playGame();
    const d = new Date('2026-11-20T10:00:00Z');
    expect(player.filename(d)).toBe('2026-11-20_K7P2QX_productor-textil_ana-perez.json');
    expect(host.filename(d)).toBe('2026-11-20_K7P2QX_anfitrion_profe.json');
    expect(slugAlias('')).toBe('anonimo');
  });
  it('detecta bitácoras inválidas', () => {
    expect(validateLog({ schemaVersion: 1 }).length).toBeGreaterThan(5);
  });
  it('compacta si supera 2 MB', () => {
    const big = {
      kpiDiarios: Array.from({ length: 4000 }, (_, i) => ({
        dia: i,
        puestos: { x: { a: 1.23456789, pad: 'x'.repeat(600) } },
      })),
      eventos: [],
    };
    const out = compactIfNeeded(big);
    expect(out.compactado).toBe(true);
    expect(JSON.stringify(out).length).toBeLessThan(2.1 * 1024 * 1024);
  });
  it('analyze-logs: sin problemas → no requiere mejora', () => {
    const { host, player } = playGame();
    const res = analyze([
      { file: 'h.json', log: host.build() },
      { file: 'p.json', log: player.build() },
    ]);
    expect(res.validas).toBe(2);
    expect(res.hallazgos.filter((h) => h.categoria !== 'Balance')).toEqual([]);
  });
  it('analyze-logs: detecta red, rendimiento, errores repetidos, sincronía y UX', () => {
    const { host, player } = playGame();
    const mk = (alias, mut) => {
      const l = player.build();
      l.alias = alias;
      mut(l);
      return l;
    };
    const logs = [
      { file: 'h.json', log: host.build() },
      {
        file: 'a.json',
        log: mk('a', (l) => {
          l.red.latenciaP95 = 650;
          l.errores.push({ mensaje: 'TypeError: x is undefined', t: 'x' });
          l.feedback = { valoracion: 2, texto: 'Muy lento' };
        }),
      },
      {
        file: 'b.json',
        log: mk('b', (l) => {
          l.rendimiento.fpsMedio = 20;
          l.rendimiento.dispositivo = 'movil';
          l.errores.push({ mensaje: 'TypeError: x is undefined', t: 'y' });
          l.feedback = { valoracion: 2, texto: 'muy lento!' };
        }),
      },
      {
        file: 'c.json',
        log: mk('c', (l) => {
          l.red.desconexiones = 5;
          l.kpiDiarios[2].kpi.cash *= 1.5;
          l.feedback = { valoracion: 3, texto: 'Muy lento' };
        }),
      },
      { file: 'roto.json', parseError: 'JSON inválido' },
    ];
    const res = analyze(logs);
    const cats = new Set(res.hallazgos.map((h) => h.categoria));
    for (const c of ['Red', 'Rendimiento', 'Errores', 'Sincronía', 'UX']) expect(cats).toContain(c);
    expect(res.invalidas.map((i) => i.file)).toEqual(['roto.json']);
  });
});
