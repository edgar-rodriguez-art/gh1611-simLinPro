// @ts-check
// HUD del distribuidor.
import { buildRoleHud, KPI_FMT as F } from './hud-common.js';

export function distributorHud(slot, onChange) {
  const sector = slot.split('-')[1];
  return buildRoleHud({
    slot,
    entityKey: 'D.' + sector,
    onChange,
    kpis: [
      { key: 'otif', label: 'OTIF', f: F.pct },
      { key: 'fillRate', label: 'Fill rate', f: F.pct },
      { key: 'leadP50', label: 'Lead time P50', f: F.hours },
      { key: 'leadP95', label: 'Lead time P95', f: F.hours },
      { key: 'fleetUtil', label: 'Utilización flota', f: F.pct },
      { key: 'margin', label: 'Margen del día', f: F.eur },
      { key: 'coverage', label: 'Cobertura (días)', f: F.num },
      { key: 'bullwhip', label: 'Efecto látigo', f: F.num },
    ],
    status: (d) => {
      const D = d['D.' + sector];
      const out = D.trucks.filter((t) => t.status !== 'idle').length;
      const price = d.kpi?.[slot]?.price;
      return `Stock: ${D.stock} u · pedidos por servir: ${D.queue} u · camiones en ruta: ${out}/${D.trucks.length}${price ? ` · precio de venta ${F.eur(price)}` : ''}`;
    },
  });
}
