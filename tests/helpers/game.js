import { Engine } from '../../src/sim/engine.js';
import { GameLogger } from '../../src/log/logger.js';

export function playGame() {
  const engine = Engine.create({ seed: 4242, days: 12 });
  engine.emitEvents = true;
  const host = new GameLogger({
    role: 'host',
    sector: null,
    alias: 'Profe',
    room: 'K7P2QX',
    seed: 4242,
    config: { velocidad: 1, dias: 12, nMC: 1000 },
    fuenteDatos: { fuente: 'por-defecto' },
    partidaId: 'K7P2QX-1',
  });
  const player = new GameLogger({
    role: 'producer',
    sector: 'textile',
    alias: 'Ána Pérez',
    room: 'K7P2QX',
    seed: 4242,
    config: { velocidad: 1, dias: 12, nMC: 1000 },
    fuenteDatos: {},
    partidaId: 'K7P2QX-1',
  });
  engine.onDayEnd = (day) => {
    const slots = engine.state.kpiDaily.at(-1).slots;
    host.kpiDay(day, slots);
    player.kpiDay(day, slots, 'producer-textile');
  };
  engine.setController('producer-textile', 'human', 'jugador');
  engine.runHours(20);
  engine.setParams('producer-textile', { shifts: 3 }, 'jugador');
  engine.runHours(60);
  engine.setParams('distributor-bakery', { trucks: 3 }, 'propuesta');
  while (!engine.state.over) {
    engine.step();
    host.events(engine.drainEvents());
  }
  for (const e of engine.state.paramLog) host.param(e);
  host.proposal({
    id: 'p1',
    t: 80,
    slot: 'distributor-bakery',
    changes: { trucks: 3 },
    before: { trucks: 2 },
    delta: { profit: 12 },
    pImprove: 0.7,
    riskP5: 0.01,
    decision: 'aceptada',
    decidedBy: 'bot',
    responseMs: 1500,
  });
  host.setRegistro({
    metricas: engine.state.metrics,
    paramLog: engine.state.paramLog,
    controlLog: engine.state.controlLog,
    controladoresIniciales: {},
  });
  host.finish();
  player.setNet({ rtts: [40, 60, 80], disconnections: 0, rejected: 0, received: 500 });
  player.setFeedback(4, 'Muy bien');
  return { engine, host, player };
}
