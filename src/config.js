// @ts-check
// Constantes del modelo, rangos de parámetros (§4.3 de CLAUDE.md) y valores por defecto.

export const PROTOCOL_VERSION = 1;
export const LOG_SCHEMA_VERSION = 1;

export const HOURS_PER_DAY = 24;
/** Segundos reales por día simulado con velocidad ×1. */
export const REAL_SECONDS_PER_DAY = 60;
export const SPEEDS = [0.5, 1, 2, 4];
export const DEFAULT_DAYS = 40;
export const DAYS_RANGE = [10, 90];
export const BANKRUPTCY_DAYS = 5;
export const DISCONNECT_BOT_MS = 15000;
export const PROPOSAL_TTL_MS = 90000;
export const SNAPSHOT_HZ = 4;
export const PING_MS = 2000;

export const MC_DEFAULT_N = 1000;
export const MC_N_RANGE = [200, 5000];
export const MC_HORIZON_DAYS = 14;
export const MC_BUDGET_MS = 3000;

/** @typedef {'bakery'|'textile'|'electronics'} SectorId */
/** @typedef {'producer'|'distributor'|'buyer'} RoleId */

/** @type {SectorId[]} */
export const SECTOR_IDS = ['bakery', 'textile', 'electronics'];
/** @type {RoleId[]} */
export const ROLE_IDS = ['producer', 'distributor', 'buyer'];

export const ROLE_LABELS = {
  host: 'Anfitrión',
  producer: 'Productor',
  distributor: 'Distribuidor',
  buyer: 'Comprador',
  supplier: 'Proveedor',
};

/** Nombre corto en español para nombres de archivo de bitácora. */
export const ROLE_FILE = {
  host: 'anfitrion',
  producer: 'productor',
  distributor: 'distribuidor',
  buyer: 'comprador',
};
export const SECTOR_FILE = { bakery: 'panaderia', textile: 'textil', electronics: 'electronica' };

/**
 * Datos base por sector. Los costos están en EUR por unidad de producto terminado.
 * refCost = insumo (50 %) + mano de obra (30 %) + gastos generales (20 %).
 */
export const SECTORS = {
  bakery: {
    label: 'Panadería',
    product: 'pan',
    input: 'harina',
    supplierLabel: 'Harina',
    lambda: 120,
    refCost: 0.8,
    lot: { min: 10, max: 500, def: 150 },
    truckCap: { min: 100, max: 600, def: 300 },
    ratePerHour: 10, // capacidad ideal (u/h) por línea
    baseDefect: 0.03,
    mtbfHours: 90,
    tripHours: [1, 2, 4],
    eurostatNace: 'C10',
  },
  textile: {
    label: 'Textil',
    product: 'prenda',
    input: 'algodón',
    supplierLabel: 'Algodón',
    lambda: 40,
    refCost: 12,
    lot: { min: 10, max: 300, def: 60 },
    truckCap: { min: 40, max: 240, def: 120 },
    ratePerHour: 3.4,
    baseDefect: 0.04,
    mtbfHours: 110,
    tripHours: [1.5, 3, 5],
    eurostatNace: 'C13',
  },
  electronics: {
    label: 'Electrónica',
    product: 'equipo',
    input: 'componentes',
    supplierLabel: 'Componentes',
    lambda: 15,
    refCost: 60,
    lot: { min: 10, max: 120, def: 20 },
    truckCap: { min: 10, max: 80, def: 40 },
    ratePerHour: 1.3,
    baseDefect: 0.05,
    mtbfHours: 70,
    tripHours: [2, 4, 7],
    eurostatNace: 'C26',
  },
};

/** Proveedores BOT: A rápido-caro, B medio, C lento-barato. leadDays = mediana del plazo lognormal. */
export const SUPPLIERS = {
  A: { label: 'A · rápido', leadDays: 1, sigma: 0.25, priceFactor: 1.15, defectAdd: 0.0 },
  B: { label: 'B · medio', leadDays: 2, sigma: 0.35, priceFactor: 1.0, defectAdd: 0.01 },
  C: { label: 'C · barato', leadDays: 4, sigma: 0.5, priceFactor: 0.88, defectAdd: 0.025 },
};

export const INSPECTION = {
  low: { label: 'bajo', defectMult: 1.5, catchRate: 0.5, slowdown: 0.0 },
  medium: { label: 'medio', defectMult: 1.0, catchRate: 0.8, slowdown: 0.04 },
  high: { label: 'alto', defectMult: 0.7, catchRate: 0.97, slowdown: 0.09 },
};

export const SHIFT_HOURS = 8;
export const SETUP_HOURS = 1;
export const RETAIL_MULT = 1.8; // precio de venta al consumidor = refCost × 1.8
export const TRUCK_DAY_COST = { bakery: 4, textile: 15, electronics: 30 }; // EUR/día por camión (capacidad por defecto)
export const TRUCK_TRIP_COST = { bakery: 1.5, textile: 5, electronics: 10 }; // EUR por salida
export const HOLDING_RATE_DAY = 0.002; // costo de almacenaje por día sobre el valor
export const RETURN_PENALTY = 0.5; // un defecto no detectado devuelve el 50 % del precio

/** Precio de referencia de distribución (costo × 1.25 × 1.2). */
export function refDistPrice(sector) {
  return SECTORS[sector].refCost * 1.25 * 1.2;
}

/**
 * Definición de parámetros por rol. type: 'int' | 'float' | 'enum'.
 * range() recibe el sector y devuelve [min, max] (para enum, la lista de opciones).
 */
export const PARAM_DEFS = {
  producer: {
    shifts: { label: 'Turnos por día', type: 'int', range: () => [1, 3], def: () => 2, step: 1 },
    lotSize: {
      label: 'Tamaño de lote (u)',
      type: 'int',
      range: (s) => [SECTORS[s].lot.min, SECTORS[s].lot.max],
      def: (s) => SECTORS[s].lot.def,
      step: 1,
    },
    price: {
      label: 'Precio mayorista (EUR/u)',
      type: 'float',
      range: (s) => [round2(SECTORS[s].refCost * 0.6), round2(SECTORS[s].refCost * 1.4)],
      def: (s) => round2(SECTORS[s].refCost * 1.25),
      step: 0.01,
    },
    reorderDays: {
      label: 'Punto de reorden (días)',
      type: 'int',
      range: () => [1, 10],
      def: () => 3,
      step: 1,
    },
    supplier: { label: 'Proveedor', type: 'enum', options: ['A', 'B', 'C'], def: () => 'B' },
    inspection: {
      label: 'Nivel de inspección',
      type: 'enum',
      options: ['low', 'medium', 'high'],
      def: () => 'medium',
    },
    maintenance: {
      label: 'Mantenimiento preventivo (%)',
      type: 'int',
      range: () => [0, 15],
      def: () => 5,
      step: 1,
    },
  },
  distributor: {
    trucks: { label: 'Camiones', type: 'int', range: () => [1, 6], def: () => 2, step: 1 },
    truckCap: {
      label: 'Capacidad por camión (u)',
      type: 'int',
      range: (s) => [SECTORS[s].truckCap.min, SECTORS[s].truckCap.max],
      def: (s) => SECTORS[s].truckCap.def,
      step: 1,
    },
    routesPerDay: {
      label: 'Salidas de ruta por día',
      type: 'int',
      range: () => [1, 4],
      def: () => 2,
      step: 1,
    },
    margin: { label: 'Margen de reventa (%)', type: 'int', range: () => [0, 60], def: () => 20, step: 1 },
    s: { label: 'Política s (días)', type: 'int', range: () => [0, 10], def: () => 2, step: 1 },
    Q: { label: 'Política Q (días)', type: 'int', range: () => [1, 20], def: () => 4, step: 1 },
  },
  buyer: {
    basketBakery: {
      label: 'Cesta pan (%)',
      type: 'int',
      range: () => [0, 100],
      def: (s) => basketDefault(s, 'bakery'),
      step: 1,
    },
    basketTextile: {
      label: 'Cesta textil (%)',
      type: 'int',
      range: () => [0, 100],
      def: (s) => basketDefault(s, 'textile'),
      step: 1,
    },
    basketElectronics: {
      label: 'Cesta electrónica (%)',
      type: 'int',
      range: () => [0, 100],
      def: (s) => basketDefault(s, 'electronics'),
      step: 1,
    },
    demandPct: {
      label: 'Demanda objetivo (%)',
      type: 'int',
      range: () => [50, 200],
      def: () => 100,
      step: 1,
    },
    maxPricePct: {
      label: 'Precio máximo (% de ref.)',
      type: 'int',
      range: () => [50, 150],
      def: () => 130,
      step: 1,
    },
    safetyDays: {
      label: 'Stock de seguridad (días)',
      type: 'int',
      range: () => [0, 7],
      def: () => 1,
      step: 1,
    },
    orderEvery: {
      label: 'Frecuencia de pedido (días)',
      type: 'int',
      range: () => [1, 7],
      def: () => 1,
      step: 1,
    },
  },
};

export const BASKET_KEYS = {
  bakery: 'basketBakery',
  textile: 'basketTextile',
  electronics: 'basketElectronics',
};

/** Cesta inicial: 70 % del sector del puesto y 15 % de cada uno de los otros dos. */
function basketDefault(slotSector, sector) {
  return slotSector === sector ? 70 : 15;
}

export function round2(x) {
  return Math.round(x * 100) / 100;
}

/** Valores por defecto de un rol y sector. */
export function defaultParams(role, sector) {
  const defs = PARAM_DEFS[role];
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, d] of Object.entries(defs)) out[k] = d.def(sector);
  return out;
}

/**
 * Aplica *clamp* y validación a un cambio de parámetros. Devuelve solo las claves válidas.
 * Para el comprador normaliza la cesta para que sume 100 %.
 */
export function clampParams(role, sector, current, changes) {
  const defs = PARAM_DEFS[role];
  if (!defs || !changes || typeof changes !== 'object') return {};
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(changes)) {
    const d = defs[k];
    if (!d) continue;
    if (d.type === 'enum') {
      if (d.options.includes(v)) out[k] = v;
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const [lo, hi] = d.range(sector);
    let x = Math.min(hi, Math.max(lo, v));
    x = d.type === 'int' ? Math.round(x) : round2(x);
    out[k] = x;
  }
  if (role === 'buyer' && Object.keys(out).some((k) => k.startsWith('basket'))) {
    const merged = { ...current, ...out };
    const keys = Object.values(BASKET_KEYS);
    const changed = keys.filter((k) => k in out);
    const fixed = changed.reduce((a, k) => a + merged[k], 0);
    if (fixed > 100) {
      // escala lo que cambió para que quepa
      for (const k of changed) out[k] = Math.round((merged[k] / fixed) * 100);
      for (const k of keys) if (!changed.includes(k)) out[k] = 0;
    } else {
      const others = keys.filter((k) => !changed.includes(k));
      const restOld = others.reduce((a, k) => a + merged[k], 0);
      const remaining = 100 - fixed;
      let acc = 0;
      others.forEach((k, i) => {
        const val =
          i === others.length - 1
            ? remaining - acc
            : Math.round(restOld > 0 ? (merged[k] / restOld) * remaining : remaining / others.length);
        out[k] = val;
        acc += val;
      });
    }
    // corrige redondeo
    const total = keys.reduce((a, k) => a + (k in out ? out[k] : merged[k]), 0);
    if (total !== 100) {
      const k = changed[0];
      out[k] += 100 - total;
    }
  }
  return out;
}

export function slotId(role, sector) {
  return `${role}-${sector}`;
}

export function parseSlot(slot) {
  const [role, sector] = String(slot).split('-');
  if (!ROLE_IDS.includes(/** @type {any} */ (role)) || !SECTOR_IDS.includes(/** @type {any} */ (sector)))
    return null;
  return { role: /** @type {RoleId} */ (role), sector: /** @type {SectorId} */ (sector) };
}

export const ALL_SLOTS = ROLE_IDS.flatMap((r) => SECTOR_IDS.map((s) => slotId(r, s)));

/** Valores por defecto de las métricas de España (respaldo 4). */
export const DEFAULT_METRICS = {
  fuente: 'por-defecto',
  fecha: '2026-01-01',
  sectors: {
    bakery: { index: 100, sigma: 0.02, period: null, fuente: 'por-defecto' },
    textile: { index: 100, sigma: 0.04, period: null, fuente: 'por-defecto' },
    electronics: { index: 100, sigma: 0.08, period: null, fuente: 'por-defecto' },
  },
  hicp: { rate: 2.5, period: null, fuente: 'por-defecto' },
};

export const ALIAS_MAX = 20;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
