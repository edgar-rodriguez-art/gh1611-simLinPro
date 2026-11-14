import { describe, it, expect } from 'vitest';
import { replay } from '../../src/sim/engine.js';
import { playGame } from '../helpers/game.js';

describe('replay desde la bitácora del anfitrión', () => {
  it('reproduce los KPI diarios registrados', () => {
    const { host } = playGame();
    const log = JSON.parse(JSON.stringify(host.build()));
    const eng = replay({
      seed: log.semilla,
      days: log.config.dias,
      metrics: log.registro.metricas,
      paramLog: log.registro.paramLog,
      controlLog: log.registro.controlLog,
      initialControllers: log.registro.controladoresIniciales,
    });
    const got = eng.state.kpiDaily.map((k) => ({ dia: k.day, puestos: k.slots }));
    expect(got).toEqual(log.kpiDiarios);
  });
});
