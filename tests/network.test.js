import { describe, it, expect } from 'vitest';
import { Engine } from '../src/sim/engine.js';
import { HostServer } from '../src/net/host.js';
import { GameClient } from '../src/net/client.js';
import { loopbackPair } from '../src/net/transport.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  let now = 0;
  const clock = { now: () => now, advance: (ms) => (now += ms) };
  const engine = Engine.create({ seed: 5, days: 10 });
  const host = new HostServer({ engine, room: 'ABCDEF', now: clock.now });
  const join = (playerId, alias) => {
    const [a, b] = loopbackPair();
    host.addConnection(a);
    const c = new GameClient({ playerId, alias, now: clock.now });
    c.attach(b);
    return { c, a, b };
  };
  return { clock, engine, host, join };
}

describe('red anfitrión ↔ jugador (bucle local)', () => {
  it('saluda, reclama puesto y cambia parámetros con clamp', async () => {
    const { host, engine, join } = setup();
    const { c } = join('p1', 'Ana');
    await flush();
    c.claim('producer-textile');
    await flush();
    expect(c.slot).toBe('producer-textile');
    expect(engine.state.slots['producer-textile'].controller).toBe('human');
    c.setParams({ shifts: 99, lotSize: 100 });
    await flush();
    expect(engine.state.producers.textile.params.shifts).toBe(3);
    expect(engine.state.producers.textile.params.lotSize).toBe(100);
    expect(host.netStats.rejected).toBe(0);
  });

  it('deniega un puesto ocupado y descarta mensajes inválidos', async () => {
    const { host, join } = setup();
    const { c: c1 } = join('p1', 'Ana');
    const { c: c2, b } = join('p2', 'Luis');
    await flush();
    c1.claim('buyer-bakery');
    await flush();
    let denied = null;
    c2.on('denied', (m) => (denied = m));
    c2.claim('buyer-bakery');
    await flush();
    expect(denied).not.toBeNull();
    b.send({ v: 1, t: 'set_params', changes: 'hack' });
    b.send('{roto');
    await flush();
    expect(host.netStats.rejected).toBe(2);
  });

  it('el bot ocupa el puesto tras 15 s de desconexión y el humano lo recupera', async () => {
    const { host, engine, join, clock } = setup();
    const { c, b } = join('p1', 'Ana');
    await flush();
    c.claim('distributor-bakery');
    await flush();
    c.closedByUser = true;
    b.close();
    await flush();
    clock.advance(5000);
    host.update();
    expect(engine.state.slots['distributor-bakery'].controller).toBe('human');
    clock.advance(11000);
    host.update();
    expect(engine.state.slots['distributor-bakery'].controller).toBe('bot');
    // conserva los parámetros
    expect(engine.state.distributors.bakery.params.trucks).toBe(2);
    const { c: again } = join('p1', 'Ana');
    await flush();
    expect(again.slot).toBe('distributor-bakery');
    expect(engine.state.slots['distributor-bakery'].controller).toBe('human');
  });

  it('propuesta aceptada aplica el cambio; la de un bot decide sola', async () => {
    const { host, engine, join, clock } = setup();
    const { c } = join('p1', 'Ana');
    await flush();
    c.claim('producer-bakery');
    await flush();
    c.on('proposal', (p) => c.answerProposal(p.id, true));
    host.sendProposal({ slot: 'producer-bakery', changes: { lotSize: 120 }, delta: { profit: 10 }, pImprove: 0.7, riskP5: 0 });
    await flush();
    await flush();
    expect(engine.state.producers.bakery.params.lotSize).toBe(120);
    expect(engine.state.paramLog.at(-1).origin).toBe('propuesta');

    host.sendProposal({ slot: 'buyer-textile', changes: { safetyDays: 3 }, delta: {}, pImprove: 0.4, riskP5: 0 });
    clock.advance(2000);
    host.update();
    expect(host.proposalLog.at(-1)).toMatchObject({ decision: 'rechazada', decidedBy: 'bot' });
    host.sendProposal({ slot: 'buyer-textile', changes: { safetyDays: 3 }, delta: {}, pImprove: 0.8, riskP5: 0.01 });
    clock.advance(2000);
    host.update();
    expect(engine.state.buyers.textile.params.safetyDays).toBe(3);
  });

  it('la propuesta expira a los 90 s y cuenta como rechazada', async () => {
    const { host, join, clock } = setup();
    const { c } = join('p1', 'Ana');
    await flush();
    c.claim('producer-bakery');
    await flush();
    host.sendProposal({ slot: 'producer-bakery', changes: { shifts: 3 }, delta: {}, pImprove: 0.9, riskP5: 0 });
    clock.advance(91000);
    c.ping(); // mantiene viva la conexión
    await flush();
    host.update();
    expect(host.proposalLog.at(-1).decision).toBe('expirada');
  });

  it('el cliente recibe snapshots con deltas y el reloj avanza', async () => {
    const { host, join, clock } = setup();
    const { c } = join('p1', 'Ana');
    await flush();
    host.start();
    for (let i = 0; i < 40; i++) {
      clock.advance(250);
      c.ping();
      host.update();
      await flush();
    }
    expect(c.data['P.bakery']).toBeTruthy();
    expect(c.simT).toBeGreaterThan(3);
  });
});
