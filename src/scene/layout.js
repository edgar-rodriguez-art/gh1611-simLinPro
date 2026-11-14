// @ts-check
// Disposición del tablero. Coordenadas de carril (u, v): u = derecha en pantalla, v = hacia el fondo.
// Con la cámara a 45° de giro, u = (1, 0, -1)/√2 y v = (-1, 0, -1)/√2 en coordenadas del mundo.
import * as THREE from 'three';

const R = Math.SQRT1_2;
export const BOARD_HALF = 19; // medio lado del cuadrado (el rombo mide 2·19·√2 de punta a punta)

/** Convierte coordenadas de carril a mundo. */
export function uv(u, v, y = 0) {
  return new THREE.Vector3((u - v) * R, y, (-u - v) * R);
}

export const LANE_V = { bakery: 7.5, textile: 0, electronics: -7.5 };
export const COL_U = { supplier: -16.5, producer: -8.5, depot: 4, buyer: 16.5 };
export const DEPOT = { u: 4, v: -3.75 };
export const HOST_POS = { u: 0, v: 19 };
export const LAKE_POS = { u: 1, v: -19.5 };

/** Ángulo para que un objeto mire a lo largo del carril (+u). */
export const LANE_YAW = Math.PI / 4;

export function stationPos(kind, sector) {
  if (kind === 'distributor') return uv(DEPOT.u, DEPOT.v);
  return uv(COL_U[kind], LANE_V[sector]);
}

/** Posición del puesto (para centrar la cámara y la insignia). */
export function slotPos(slot) {
  const [role, sector] = slot.split('-');
  if (role === 'distributor')
    return uv(DEPOT.u + (sector === 'bakery' ? -2.4 : sector === 'textile' ? 0 : 2.4), DEPOT.v);
  return stationPos(role, sector);
}

/** Ruta del camión: andén del distribuidor → carretera transversal → carril del comprador → tienda. */
export function truckCurve(distSector, buyerSector) {
  const dockU = DEPOT.u + (distSector === 'bakery' ? -2.4 : distSector === 'textile' ? 0 : 2.4);
  const laneV = LANE_V[buyerSector] - 1.1;
  const pts = [
    uv(dockU, DEPOT.v - 2.2),
    uv(DEPOT.u + 5.5, DEPOT.v - 2.2),
    uv(DEPOT.u + 7, (DEPOT.v - 2.2 + laneV) / 2),
    uv(DEPOT.u + 8.5, laneV),
    uv(COL_U.buyer - 2.6, laneV),
  ];
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
}

/** Ruta del productor al centro logístico (envíos de lotes). */
export function shipCurve(sector) {
  const v = LANE_V[sector] - 1.1;
  const dockU = DEPOT.u + (sector === 'bakery' ? -2.4 : sector === 'textile' ? 0 : 2.4);
  return new THREE.CatmullRomCurve3(
    [
      uv(COL_U.producer + 2.2, v),
      uv(DEPOT.u - 5, v),
      uv(DEPOT.u - 4, (v + DEPOT.v + 2.4) / 2),
      uv(dockU, DEPOT.v + 2.4),
    ],
    false,
    'catmullrom',
    0.3,
  );
}

/** Ruta de insumos: proveedor → productor. */
export function supplyCurve(sector) {
  const v = LANE_V[sector] + 1.1;
  return new THREE.CatmullRomCurve3([uv(COL_U.supplier + 2, v), uv(COL_U.producer - 2.4, v)]);
}
