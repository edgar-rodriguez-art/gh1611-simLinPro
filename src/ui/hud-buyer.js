// @ts-check
// HUD del comprador.
import { buildRoleHud, KPI_FMT as F } from './hud-common.js';
import { SECTOR_IDS, SECTORS } from '../config.js';

export function buyerHud(slot, onChange) {
  const sector = slot.split('-')[1];
  return buildRoleHud({
    slot,
    entityKey: 'B.' + sector,
    onChange,
    kpis: [
      { key: 'fillRate', label: 'Fill rate', f: F.pct },
      { key: 'lost', label: 'Ventas perdidas (u)', f: F.int },
      { key: 'revenue', label: 'Ventas del día', f: F.eur },
      { key: 'margin', label: 'Margen del día', f: F.eur },
      { key: 'coverage', label: 'Cobertura (días)', f: F.num },
      { key: 'pending', label: 'Pedidos pendientes (u)', f: F.int },
      { key: 'rejected', label: 'Pedidos por precio', f: F.int },
      { key: 'bullwhip', label: 'Efecto látigo', f: F.num },
    ],
    status: (d) => {
      const B = d['B.' + sector];
      return 'Stock: ' + SECTOR_IDS.map((s) => `${SECTORS[s].product} ${B.stock[s]} (+${B.onOrder[s]})`).join(' · ');
    },
  });
}
