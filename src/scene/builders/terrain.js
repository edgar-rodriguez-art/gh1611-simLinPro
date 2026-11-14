// @ts-check
// Tablero en rombo, carreteras, flechas de flujo, árboles, montañas, lago y arcos de red.
import * as THREE from 'three';
import { PALETTE } from '../palette.js';
import { mesh, cone } from './common.js';
import { uv, BOARD_HALF, LANE_V, COL_U, DEPOT, HOST_POS, LAKE_POS, LANE_YAW } from '../layout.js';
import { SECTOR_IDS } from '../../config.js';

/** Tablero: losa con cara superior naranja y bordes en dos tonos. */
export function board() {
  const g = new THREE.Group();
  const S = BOARD_HALF * 2;
  const geo = new THREE.BoxGeometry(S, 1.6, S);
  // materiales por cara: +x, -x, +y, -y, +z, -z
  const top = new THREE.MeshLambertMaterial({ color: PALETTE.ground, flatShading: true });
  const a = new THREE.MeshLambertMaterial({ color: PALETTE.edgeA, flatShading: true });
  const b = new THREE.MeshLambertMaterial({ color: PALETTE.edgeB, flatShading: true });
  const slab = new THREE.Mesh(geo, [a, b, top, b, b, a]);
  slab.position.y = -0.8;
  slab.receiveShadow = true;
  g.add(slab);
  // baldosas sutiles (líneas de rejilla)
  const lines = [];
  const step = 3.8;
  for (let x = -BOARD_HALF + step; x < BOARD_HALF; x += step) {
    lines.push(x, 0.01, -BOARD_HALF, x, 0.01, BOARD_HALF);
    lines.push(-BOARD_HALF, 0.01, x, BOARD_HALF, 0.01, x);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: PALETTE.edgeA, transparent: true, opacity: 0.25 })));
  return g;
}

/** Tramo recto de carretera de (u1,v) a (u2,v) o vertical. */
function roadStrip(p1, p2, width) {
  const len = p1.distanceTo(p2);
  const m = mesh(new THREE.BoxGeometry(len, 0.08, width), PALETTE.road, { shadow: false, receive: true });
  m.position.copy(p1).add(p2).multiplyScalar(0.5);
  m.position.y = 0.04;
  m.rotation.y = Math.atan2(-(p2.z - p1.z), p2.x - p1.x);
  return m;
}

function dashes(p1, p2, n) {
  const g = new THREE.Group();
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const yaw = Math.atan2(-dir.z, dir.x);
  const geo = new THREE.BoxGeometry(0.5, 0.02, 0.09);
  const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: PALETTE.roadLine }), n);
  const o = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    o.position.copy(p1).addScaledVector(dir, (i + 0.5) / n);
    o.position.y = 0.1;
    o.rotation.set(0, yaw, 0);
    o.updateMatrix();
    inst.setMatrixAt(i, o.matrix);
  }
  g.add(inst);
  return g;
}

/** Flecha plana en el suelo (flujo de material o de dinero). */
function arrow(p1, p2, color, dashed = false) {
  const g = new THREE.Group();
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  const yaw = Math.atan2(-dir.z, dir.x);
  const segs = dashed ? Math.max(2, Math.floor(len / 0.9)) : 1;
  const segLen = dashed ? (len - 0.8) / segs - 0.3 : len - 0.8;
  for (let i = 0; i < segs; i++) {
    const s = mesh(new THREE.BoxGeometry(Math.max(0.2, segLen), 0.04, dashed ? 0.12 : 0.18), color, { shadow: false });
    const t = dashed ? (i * (segLen + 0.3) + segLen / 2) / len : (len - 0.8) / 2 / len;
    s.position.copy(p1).addScaledVector(dir, t);
    s.position.y = 0.11;
    s.rotation.y = yaw;
    g.add(s);
  }
  const head = new THREE.Shape();
  head.moveTo(0, 0.4);
  head.lineTo(0.8, 0);
  head.lineTo(0, -0.4);
  head.lineTo(0, 0.4);
  const hg = new THREE.ShapeGeometry(head).rotateX(-Math.PI / 2);
  const hm = mesh(hg, color, { shadow: false, opts: { side: THREE.DoubleSide } });
  hm.position.copy(p1).addScaledVector(dir, (len - 0.8) / len);
  hm.position.y = 0.12;
  hm.rotation.y = yaw;
  g.add(hm);
  return g;
}

/** Carreteras de los 3 carriles, carretera transversal y flechas de flujo del diagrama. */
export function roads() {
  const g = new THREE.Group();
  for (const s of SECTOR_IDS) {
    const v = LANE_V[s] - 1.1;
    const a = uv(COL_U.producer + 1.6, v);
    const b = uv(COL_U.buyer - 1.2, v);
    g.add(roadStrip(a, b, 1.25));
    g.add(dashes(a, b, 22));
    // flecha verde (material) bajo la carretera y dorada discontinua (dinero) en sentido inverso
    g.add(arrow(uv(COL_U.supplier + 2.3, LANE_V[s] - 2.15), uv(COL_U.producer - 2.2, LANE_V[s] - 2.15), PALETTE.material));
    g.add(arrow(uv(COL_U.producer + 2.4, LANE_V[s] - 2.15), uv(DEPOT.u - 3.6, LANE_V[s] - 2.15), PALETTE.material));
    g.add(arrow(uv(DEPOT.u + 4.2, LANE_V[s] - 2.15), uv(COL_U.buyer - 2.4, LANE_V[s] - 2.15), PALETTE.material));
    g.add(arrow(uv(COL_U.buyer - 2.4, LANE_V[s] - 0.05), uv(DEPOT.u + 4.6, LANE_V[s] - 0.05), PALETTE.money, true));
    g.add(arrow(uv(DEPOT.u - 3.6, LANE_V[s] - 0.05), uv(COL_U.producer + 2.4, LANE_V[s] - 0.05), PALETTE.money, true));
    g.add(arrow(uv(COL_U.producer - 2.4, LANE_V[s] + 2.4), uv(COL_U.supplier + 2.4, LANE_V[s] + 2.4), PALETTE.money, true));
  }
  // carretera transversal del centro logístico
  const top = uv(DEPOT.u + 7, LANE_V.bakery - 1.1);
  const bot = uv(DEPOT.u + 7, LANE_V.electronics - 1.1);
  g.add(roadStrip(top, bot, 1.4));
  g.add(dashes(top, bot, 10));
  const yard = roadStrip(uv(DEPOT.u - 4.5, DEPOT.v - 2.2), uv(DEPOT.u + 7, DEPOT.v - 2.2), 1.3);
  g.add(yard);
  return g;
}

function rand(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Árboles cono azules (InstancedMesh). */
export function trees() {
  const spots = [
    [-12.5, 12.5], [-4, 12.5], [6, 11.5], [11, 4.5], [-13, -3.5], [-3, 3.8], [-3, -4], [9.5, -11.5],
    [-12.5, -11.5], [-5, -12], [12, 12], [-19.5, 1], [21, 4], [21, -4], [-8, 16], [8, 15.5], [-16, 5], [14, -15],
  ];
  const r = rand(17);
  const geo = new THREE.ConeGeometry(0.75, 2.2, 5);
  geo.translate(0, 1.1, 0);
  const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: PALETTE.tree, flatShading: true }), spots.length);
  inst.castShadow = true;
  const o = new THREE.Object3D();
  spots.forEach(([u, v], i) => {
    o.position.copy(uv(u, v));
    const s = 0.8 + r() * 0.5;
    o.scale.set(s, s * (0.9 + r() * 0.4), s);
    o.rotation.y = r() * 3;
    o.updateMatrix();
    inst.setMatrixAt(i, o.matrix);
  });
  return inst;
}

/** Montañas detrás del tablero con nieve en la cima. */
export function mountains() {
  const g = new THREE.Group();
  const defs = [
    [-24, 22, 9, 15, PALETTE.mountainOrange],
    [-14, 28, 8, 19, PALETTE.mountainOrange],
    [-2, 33, 7, 13, PALETTE.mountainLilac],
    [12, 28, 8, 18, PALETTE.mountainLilac],
    [24, 21, 9, 14, PALETTE.mountainLilac],
    [31, 12, 6, 10, PALETTE.mountainLilac],
    [-31, 12, 6, 9, PALETTE.mountainOrange],
  ];
  for (const [u, v, r, h, c] of defs) {
    const m = cone(r, h, 5, c);
    m.position.add(uv(u, v, -1.6));
    m.rotation.y = u * 0.3;
    g.add(m);
    const capH = h * 0.28;
    const snow = cone((r * capH) / h + 0.05, capH, 5, PALETTE.snow, { shadow: false });
    snow.position.copy(uv(u, v, -1.6 + h - capH));
    snow.position.y += capH / 2;
    snow.rotation.y = u * 0.3;
    g.add(snow);
  }
  return g;
}

/** Lago poligonal en la esquina delantera. */
export function lake() {
  const shape = new THREE.Shape();
  const pts = [
    [-6, -0.5], [-3.5, 3], [1.5, 3.6], [6, 2], [7, -1], [4, -3.4], [-1.5, -3.6], [-5, -2.8],
  ];
  shape.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) shape.lineTo(x, y);
  const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  const m = mesh(geo, PALETTE.water, { shadow: false, receive: true });
  m.position.copy(uv(LAKE_POS.u, LAKE_POS.v, 0.05));
  m.rotation.y = LANE_YAW;
  return m;
}

/** Arcos discontinuos de red (PeerJS) desde la antena del anfitrión a cada puesto. */
export function networkArcs(targets) {
  const g = new THREE.Group();
  const from = uv(HOST_POS.u, HOST_POS.v, 10.9);
  const matl = new THREE.LineDashedMaterial({ color: PALETTE.network, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.55 });
  for (const to of targets) {
    const mid = from.clone().add(to).multiplyScalar(0.5);
    mid.y = Math.max(from.y, to.y) + 3;
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
    const line = new THREE.Line(geo, matl);
    line.computeLineDistances();
    g.add(line);
  }
  return g;
}
