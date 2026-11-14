// @ts-check
// Utilidades de geometría low-poly: materiales con flatShading en caché y primitivas.
import * as THREE from 'three';

const mats = new Map();

/** Material Lambert con sombreado plano (sin texturas). */
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
    mats.set(key, m);
  }
  return m;
}

export function mesh(geo, color, { shadow = true, receive = false, opts = {} } = {}) {
  const m = new THREE.Mesh(geo, mat(color, opts));
  m.castShadow = shadow;
  m.receiveShadow = receive;
  return m;
}

export function box(w, h, d, color, o = {}) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), color, o);
  m.position.y = h / 2;
  return m;
}

export function cyl(rt, rb, h, seg, color, o = {}) {
  const m = mesh(new THREE.CylinderGeometry(rt, rb, h, seg), color, o);
  m.position.y = h / 2;
  return m;
}

export function cone(r, h, seg, color, o = {}) {
  const m = mesh(new THREE.ConeGeometry(r, h, seg), color, o);
  m.position.y = h / 2;
  return m;
}

/** Tejado a dos aguas (prisma triangular) de ancho w (eje x), fondo d (eje z) y altura h. */
export function gableRoof(w, h, d, color) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.lineTo(-w / 2, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  return mesh(geo, color);
}

export function at(obj, x, y, z) {
  obj.position.set(x, obj.position.y + y, z);
  return obj;
}

/** Cuenta triángulos de un objeto (para el presupuesto de < 60k). */
export function countTriangles(root) {
  let n = 0;
  root.traverse((o) => {
    const m = /** @type {any} */ (o);
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry;
    const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    n += tris * (m.isInstancedMesh ? m.count : 1);
  });
  return Math.round(n);
}
