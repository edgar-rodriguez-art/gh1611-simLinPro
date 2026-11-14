import { describe, it, expect } from 'vitest';
import { Engine, replay } from '../src/sim/engine.js';
import { Rng } from '../src/sim/rng.js';
import { clampParams, defaultParams } from '../src/config.js';

describe('motor', () => {
  it('es determinista con la misma semilla', () => {
    const a = Engine.create({ seed: 123, days: 12 });
    const b = Engine.create({ seed: 123, days: 12 });
    a.runDays(12);
    b.runDays(12);
    expect(JSON.stringify(a.state.kpiDaily)).toBe(JSON.stringify(b.state.kpiDaily));
    expect(a.state.over).toBe(true);
  });

  it('cambia con otra semilla', () => {
    const a = Engine.create({ seed: 1, days: 5 });
    const b = Engine.create({ seed: 2, days: 5 });
    a.runDays(5);
    b.runDays(5);
    expect(JSON.stringify(a.state.kpiDaily)).not.toBe(JSON.stringify(b.state.kpiDaily));
  });

  it('con parámetros por defecto nadie quiebra en 40 días', () => {
    for (const seed of [7, 8, 9]) {
      const e = Engine.create({ seed, days: 40 });
      e.runDays(40);
      expect(e.state.bankruptcies || []).toEqual([]);
    }
  });

  it('aplica clamp a los parámetros y registra el cambio', () => {
    const e = Engine.create({ seed: 5 });
    const applied = e.setParams('producer-bakery', { shifts: 9, lotSize: -4, foo: 1 }, 'jugador');
    expect(applied).toEqual({ shifts: 3, lotSize: 10 });
    expect(e.state.paramLog).toHaveLength(2);
    expect(e.state.paramLog[0]).toMatchObject({ slot: 'producer-bakery', param: 'shifts', old: 2, new: 3 });
  });

  it('la cesta del comprador siempre suma 100 %', () => {
    const cur = defaultParams('buyer', 'bakery');
    const out = clampParams('buyer', 'bakery', cur, { basketBakery: 40 });
    const merged = { ...cur, ...out };
    expect(merged.basketBakery + merged.basketTextile + merged.basketElectronics).toBe(100);
    expect(merged.basketBakery).toBe(40);
  });

  it('un parámetro tiene efecto medible (turnos → OEE y producción)', () => {
    const base = Engine.create({ seed: 11, days: 10 });
    const one = Engine.create({ seed: 11, days: 10 });
    one.setParams('producer-textile', { shifts: 1, inspection: 'high' });
    base.runDays(10);
    one.runDays(10);
    const fgBase = base.state.producers.textile.fgStock + base.state.distributors.textile.stock;
    const fgOne = one.state.producers.textile.fgStock + one.state.distributors.textile.stock;
    expect(fgOne).toBeLessThan(fgBase);
  });

  it('el bot ocupa el puesto y lo devuelve al humano', () => {
    const e = Engine.create({ seed: 3, controllers: { 'producer-bakery': 'human' } });
    expect(e.state.slots['producer-bakery'].controller).toBe('human');
    e.setController('producer-bakery', 'bot', 'desconexion');
    expect(e.state.slots['producer-bakery'].controller).toBe('bot');
    e.setController('producer-bakery', 'human', 'reconexion');
    expect(e.state.controlLog).toHaveLength(2);
  });

  it('el replay reproduce los KPI del anfitrión', () => {
    const e = Engine.create({ seed: 99, days: 10, controllers: { 'distributor-textile': 'human' } });
    e.runHours(30);
    e.setParams('distributor-textile', { trucks: 4, margin: 30 }, 'jugador');
    e.runHours(50);
    e.setController('distributor-textile', 'bot', 'desconexion');
    e.setParams('producer-bakery', { lotSize: 200 }, 'propuesta');
    while (!e.state.over) e.step();
    const r = replay({
      seed: 99,
      days: 10,
      paramLog: e.state.paramLog,
      controlLog: e.state.controlLog,
      initialControllers: { 'distributor-textile': 'human' },
    });
    expect(JSON.stringify(r.state.kpiDaily)).toBe(JSON.stringify(e.state.kpiDaily));
  });

  it('serializa y reanuda desde un snapshot', () => {
    const a = Engine.create({ seed: 77, days: 8 });
    a.runDays(3);
    const b = Engine.fromState(JSON.parse(JSON.stringify(a.state)));
    a.runDays(5);
    b.runDays(5);
    expect(JSON.stringify(b.state.kpiDaily)).toBe(JSON.stringify(a.state.kpiDaily));
  });
});

describe('rng', () => {
  it('mulberry32 reproducible y distribuciones con medias razonables', () => {
    const r = new Rng(1);
    const r2 = new Rng(1);
    expect(r.next()).toBe(r2.next());
    let s = 0;
    for (let i = 0; i < 20000; i++) s += r.poisson(4);
    expect(s / 20000).toBeCloseTo(4, 1);
    let e = 0;
    for (let i = 0; i < 20000; i++) e += r.exponential(10);
    expect(e / 20000).toBeGreaterThan(9.5);
    expect(e / 20000).toBeLessThan(10.5);
    let tri = 0;
    for (let i = 0; i < 20000; i++) tri += r.triangular(1, 2, 6);
    expect(tri / 20000).toBeCloseTo(3, 1);
  });
});
