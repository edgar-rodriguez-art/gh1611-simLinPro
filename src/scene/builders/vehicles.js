// @ts-check
// Camiones y furgonetas low-poly con carga visible.
import * as THREE from 'three';
import { PALETTE } from '../palette.js';
import { box } from './common.js';

/** Camión: cabina del color del sector, caja blanca y carga (cajas verdes) visible si va lleno. */
export function truck(color, scale = 1) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  const cab = box(0.55, 0.55, 0.62, color);
  cab.position.x = 0.62;
  body.add(cab);
  const win = box(0.05, 0.22, 0.5, PALETTE.dark, { shadow: false });
  win.position.set(0.9, 0.28, 0);
  body.add(win);
  const bed = box(1.1, 0.12, 0.66, PALETTE.lightGray);
  bed.position.set(-0.22, 0.12, 0);
  body.add(bed);
  const cargo = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const c = box(0.32, 0.32, 0.5, i === 1 ? PALETTE.wheat : PALETTE.material);
    c.position.set(-0.6 + i * 0.36, 0.18, 0);
    cargo.add(c);
  }
  body.add(cargo);
  for (const [x, z] of [
    [0.55, 0.32],
    [-0.5, 0.32],
    [0.55, -0.32],
    [-0.5, -0.32],
  ]) {
    const w = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.1, 6).rotateX(Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: PALETTE.dark, flatShading: true }),
    );
    w.position.set(x, 0.13, z);
    body.add(w);
  }
  body.position.y = 0.06;
  g.add(body);
  g.scale.setScalar(scale);
  g.userData.cargo = cargo;
  return g;
}
