// @ts-check
// HUD del productor.
import { buildRoleHud, KPI_FMT as F } from './hud-common.js';
import { SECTORS } from '../config.js';

const STATUS = { run: 'produciendo', idle: 'en espera', down: 'AVERÍA', off: 'fuera de turno' };

export function producerHud(slot, onChange) {
  const sector = slot.split('-')[1];
  return buildRoleHud({
    slot,
    entityKey: 'P.' + sector,
    onChange,
    kpis: [
      { key: 'oee', label: 'OEE', f: F.pct },
      { key: 'fillRate', label: 'Fill rate', f: F.pct },
      { key: 'availability', label: 'Disponibilidad', f: F.pct },
      { key: 'quality', label: 'Calidad', f: F.pct },
      { key: 'unitCost', label: 'Costo unitario', f: (x) => F.eur(x) },
      { key: 'margin', label: 'Margen del día', f: F.eur },
      { key: 'coverage', label: 'Cobertura (días)', f: F.num },
      { key: 'bullwhip', label: 'Efecto látigo', f: F.num },
    ],
    status: (d) => {
      const P = d['P.' + sector];
      const lot = P.lot ? (P.lot[2] ? ' · preparando lote' : ` · lote ${P.lot[0]}/${P.lot[1]}`) : '';
      return `Máquina: ${STATUS[P.status] || P.status}${lot} · ${SECTORS[sector].input}: ${P.inputStock} u (${P.inbound} pedidos en camino) · producto: ${P.fgStock} u · pendiente: ${P.backlog} u`;
    },
  });
}
