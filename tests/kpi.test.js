import { describe, it, expect } from 'vitest';
import { oee, percentile, variance, bullwhip, fillRate, producerKpi, coverageDays } from '../src/sim/kpi.js';

describe('KPI calculados a mano', () => {
  it('OEE = disponibilidad × rendimiento × calidad', () => {
    expect(oee(0.9, 0.95, 0.99)).toBeCloseTo(0.84645, 5);
  });
  it('percentiles con interpolación lineal', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(a, 50)).toBeCloseTo(5.5);
    expect(percentile(a, 95)).toBeCloseTo(9.55);
    expect(percentile([], 50)).toBe(0);
  });
  it('varianza muestral y efecto látigo', () => {
    expect(variance([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(4.5714, 3);
    expect(bullwhip([0, 20, 0, 20], [10, 10, 9, 11])).toBeCloseTo(133.33 / 0.6667, 0);
  });
  it('fill rate y cobertura', () => {
    expect(fillRate(90, 100)).toBe(0.9);
    expect(fillRate(0, 0)).toBe(1);
    expect(coverageDays(300, 100)).toBe(3);
  });
  it('KPI del productor', () => {
    const k = producerKpi({
      plannedH: 16,
      runH: 12,
      produced: 100,
      good: 95,
      idealRate: 10,
      shipped: 80,
      requested: 100,
      revenue: 500,
      costs: 380,
    });
    expect(k.availability).toBeCloseTo(0.75);
    expect(k.performance).toBeCloseTo(100 / 120);
    expect(k.quality).toBeCloseTo(0.95);
    expect(k.oee).toBeCloseTo(0.75 * (100 / 120) * 0.95);
    expect(k.fillRate).toBe(0.8);
    expect(k.unitCost).toBeCloseTo(4);
    expect(k.margin).toBe(120);
  });
});
