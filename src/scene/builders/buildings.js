// @ts-check
// Edificios procedurales low-poly. Eje local x = a lo largo del carril; z+ = hacia la cámara.
// Cada grupo expone en userData las piezas animables: spin (giran según la producción), smoke (ancla del humo),
// bar (ancla de la barra de progreso), top (altura para la insignia).
import * as THREE from 'three';
import { PALETTE } from '../palette.js';
import { box, cyl, cone, gableRoof, mesh, mat } from './common.js';

function group(top) {
  const g = new THREE.Group();
  g.userData = { spin: [], top, smoke: null, bar: null };
  return g;
}

// ───────────── Proveedores ─────────────

/** Molino con aspas y trigal (proveedor de harina). */
export function windmill() {
  const g = group(7.6);
  const tower = cyl(0.75, 1.1, 4.2, 8, PALETTE.white);
  g.add(tower);
  const roof = cone(1.05, 1.3, 8, PALETTE.bakery);
  roof.position.y = 4.2 + 0.65;
  g.add(roof);
  const door = box(0.45, 0.8, 0.1, PALETTE.dark, { shadow: false });
  door.position.z = 1.0;
  g.add(door);
  const hub = new THREE.Group();
  hub.position.set(0, 3.9, 1.15);
  for (let i = 0; i < 4; i++) {
    const blade = mesh(new THREE.BoxGeometry(0.42, 2.6, 0.06), PALETTE.white);
    blade.position.y = 1.35;
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2;
    arm.add(blade);
    hub.add(arm);
  }
  hub.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.25, 6).rotateX(Math.PI / 2), PALETTE.dark));
  g.add(hub);
  g.userData.spin.push({ obj: hub, axis: 'z', k: 1 });
  // trigal
  const field = new THREE.Group();
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) {
      const w = box(0.85, 0.35, 0.85, PALETTE.wheat, { shadow: false, receive: true });
      w.position.set(2.0 + i * 0.95, w.position.y, -1.2 + j * 0.95);
      field.add(w);
    }
  g.add(field);
  return g;
}

/** Campo de algodón y silo (proveedor de algodón). */
export function cottonFarm() {
  const g = group(5.6);
  const silo = cyl(0.9, 0.9, 3.6, 8, PALETTE.lightGray);
  silo.position.x = -1.2;
  g.add(silo);
  const cap = cone(1.0, 0.8, 8, PALETTE.textile);
  cap.position.set(-1.2, 3.6 + 0.4, 0);
  g.add(cap);
  // ventilador del silo (gira con la producción)
  const fan = new THREE.Group();
  fan.position.set(-1.2, 2.6, 0.95);
  for (let i = 0; i < 3; i++) {
    const b = mesh(new THREE.BoxGeometry(0.16, 0.7, 0.04), PALETTE.dark);
    b.position.y = 0.32;
    const a = new THREE.Group();
    a.rotation.z = (i * 2 * Math.PI) / 3;
    a.add(b);
    fan.add(a);
  }
  g.add(fan);
  g.userData.spin.push({ obj: fan, axis: 'z', k: 2 });
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) {
      const x = 0.6 + i * 0.95;
      const z = -1.2 + j * 0.95;
      const bush = box(0.7, 0.45, 0.7, PALETTE.cotton, { shadow: false });
      bush.position.set(x, bush.position.y, z);
      g.add(bush);
      const ball = mesh(new THREE.IcosahedronGeometry(0.17, 0), PALETTE.white, { shadow: false });
      ball.position.set(x, 0.55, z);
      g.add(ball);
    }
  return g;
}

/** Contenedores apilados (proveedor de componentes). */
export function containers() {
  const g = group(4.2);
  const colors = [PALETTE.material, PALETTE.danger, PALETTE.wheat, PALETTE.electronics];
  const spots = [
    [0, 0, 0],
    [0, 0, 1.25],
    [0, 1.1, 0.6],
    [2.6, 0, 0.3],
  ];
  spots.forEach(([x, y, z], i) => {
    const c = box(2.4, 1.05, 1.15, colors[i % colors.length]);
    c.position.set(x, c.position.y + y, z);
    g.add(c);
    for (let k = -2; k <= 2; k++) {
      const rib = box(0.05, 0.95, 1.18, 0x000000, { shadow: false, opts: { transparent: true, opacity: 0.12 } });
      rib.position.set(x + k * 0.45, rib.position.y + y + 0.05, z);
      g.add(rib);
    }
  });
  // grúa con brazo giratorio
  const mast = box(0.25, 3.6, 0.25, PALETTE.wheat);
  mast.position.set(-1.8, mast.position.y, -0.8);
  g.add(mast);
  const jib = new THREE.Group();
  jib.position.set(-1.8, 3.6, -0.8);
  const arm = box(3.2, 0.2, 0.2, PALETTE.wheat);
  arm.position.x = 1.2;
  jib.add(arm);
  g.add(jib);
  g.userData.spin.push({ obj: jib, axis: 'y', k: 0.25 });
  return g;
}

// ───────────── Productores ─────────────

/** Panadería con chimenea. */
export function bakery() {
  const g = group(5.8);
  g.add(box(3.6, 2.0, 2.8, PALETTE.white));
  const roof = gableRoof(4.0, 1.4, 3.2, PALETTE.bakery);
  roof.position.y = 2.0;
  g.add(roof);
  const chimney = box(0.5, 1.6, 0.5, PALETTE.dark);
  chimney.position.set(1.0, 2.6, -0.5);
  g.add(chimney);
  const door = box(0.7, 1.1, 0.08, PALETTE.bakery, { shadow: false });
  door.position.z = 1.42;
  g.add(door);
  const win = box(0.8, 0.6, 0.08, PALETTE.wheat, { shadow: false });
  win.position.set(-1.1, 1.0, 1.42);
  g.add(win);
  // amasadora (rueda que gira en el lateral)
  const wheel = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.15, 7).rotateZ(Math.PI / 2), PALETTE.dark);
  wheel.position.set(1.88, 1.0, 0.6);
  g.add(wheel);
  g.userData.spin.push({ obj: wheel, axis: 'x', k: 2 });
  g.userData.smoke = new THREE.Vector3(1.0, 3.5, -0.5);
  g.userData.bar = new THREE.Vector3(0, 4.6, 0);
  return g;
}

/** Nave textil con tejado en diente de sierra. */
export function textileMill() {
  const g = group(5.2);
  g.add(box(4.6, 1.9, 3.0, PALETTE.lightGray));
  for (let i = 0; i < 3; i++) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(1.533, 0);
    shape.lineTo(1.533, 1.1);
    shape.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 3.0, bevelEnabled: false });
    geo.translate(-2.3 + i * 1.533, 1.9, -1.5);
    g.add(mesh(geo, PALETTE.textile));
  }
  const door = box(1.2, 1.2, 0.08, PALETTE.textile, { shadow: false });
  door.position.z = 1.52;
  g.add(door);
  // carrete giratorio (telar)
  const reel = mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.6, 8).rotateX(Math.PI / 2), PALETTE.white);
  reel.position.set(-2.55, 0.9, 0.6);
  g.add(reel);
  g.userData.spin.push({ obj: reel, axis: 'z', k: 2.5 });
  g.userData.smoke = new THREE.Vector3(1.5, 3.1, 0);
  g.userData.bar = new THREE.Vector3(0, 4.2, 0);
  return g;
}

/** Planta electrónica con techo azul. */
export function electronicsPlant() {
  const g = group(4.6);
  g.add(box(4.2, 1.8, 3.2, PALETTE.white));
  const roof = box(4.5, 0.35, 3.5, PALETTE.electronics);
  roof.position.y = 1.8 + 0.17;
  g.add(roof);
  for (let i = 0; i < 3; i++) {
    const unit = box(0.55, 0.35, 0.55, PALETTE.lightGray);
    unit.position.set(-1.2 + i * 1.1, 2.15 + unit.position.y, -0.5);
    g.add(unit);
    const fan = mesh(new THREE.BoxGeometry(0.5, 0.04, 0.1), PALETTE.dark, { shadow: false });
    const fg = new THREE.Group();
    fg.position.set(-1.2 + i * 1.1, 2.55, -0.5);
    fg.add(fan);
    g.add(fg);
    g.userData.spin.push({ obj: fg, axis: 'y', k: 4 });
  }
  const band = box(4.22, 0.25, 3.22, PALETTE.electronics, { shadow: false });
  band.position.y = 0.6;
  g.add(band);
  g.userData.smoke = new THREE.Vector3(1.4, 2.6, 0.6);
  g.userData.bar = new THREE.Vector3(0, 3.8, 0);
  return g;
}

// ───────────── Centro logístico ─────────────

/** Almacén con tres andenes (uno por distribuidor). */
export function warehouse() {
  const g = group(5.5);
  g.add(box(7.6, 2.4, 3.8, PALETTE.distributorWall));
  const roof = gableRoof(8.2, 1.6, 4.3, PALETTE.distributorRoof);
  roof.position.y = 2.4;
  g.add(roof);
  const docks = [];
  for (let i = 0; i < 3; i++) {
    const door = box(1.3, 1.5, 0.08, PALETTE.dark, { shadow: false });
    door.position.set(-2.4 + i * 2.4, door.position.y, 1.92);
    g.add(door);
    const ramp = box(1.6, 0.25, 0.8, PALETTE.lightGray, { shadow: false, receive: true });
    ramp.position.set(-2.4 + i * 2.4, ramp.position.y, 2.3);
    g.add(ramp);
    docks.push(door);
    const back = box(1.3, 1.5, 0.08, PALETTE.dark, { shadow: false });
    back.position.set(-2.4 + i * 2.4, back.position.y, -1.92);
    g.add(back);
  }
  g.userData.docks = docks;
  return g;
}

// ───────────── Compradores ─────────────

/** Tienda con toldo a rayas. */
export function shop(color) {
  const g = group(4.6);
  g.add(box(3.0, 1.8, 2.6, PALETTE.white));
  const roof = gableRoof(3.4, 1.2, 3.0, color);
  roof.position.y = 1.8;
  g.add(roof);
  for (let i = 0; i < 5; i++) {
    const stripe = box(0.56, 0.08, 0.9, i % 2 ? PALETTE.white : color, { shadow: false });
    stripe.position.set(-1.12 + i * 0.56, 1.25, 1.65);
    stripe.rotation.x = 0.35;
    g.add(stripe);
  }
  const win = box(1.8, 0.7, 0.08, PALETTE.electronics, { shadow: false, opts: { transparent: true, opacity: 0.7 } });
  win.position.set(-0.3, 0.55, 1.32);
  g.add(win);
  return g;
}

// ───────────── Anfitrión ─────────────

/** Torre del anfitrión con antena. */
export function hostTower() {
  const g = group(11);
  const base = box(4.4, 0.8, 4.4, PALETTE.lightGray);
  g.add(base);
  const body = box(3.0, 6.0, 3.0, PALETTE.white);
  body.position.y += 0.8;
  g.add(body);
  const cap = mesh(new THREE.CylinderGeometry(2.3, 3.1, 1.3, 4).rotateY(Math.PI / 4), PALETTE.host);
  cap.position.y = 6.8 + 0.65;
  g.add(cap);
  const cap2 = mesh(new THREE.CylinderGeometry(1.2, 2.0, 0.9, 4).rotateY(Math.PI / 4), PALETTE.host);
  cap2.position.y = 8.1 + 0.45;
  g.add(cap2);
  const mast = cyl(0.07, 0.1, 1.8, 5, PALETTE.dark);
  mast.position.y = 9.0 + 0.9;
  g.add(mast);
  const tip = mesh(new THREE.IcosahedronGeometry(0.2, 0), PALETTE.network, { opts: { emissive: PALETTE.network } });
  tip.position.y = 10.85;
  g.add(tip);
  for (let i = 0; i < 4; i++) {
    const w = box(0.5, 0.7, 0.06, PALETTE.host, { shadow: false });
    w.position.set(-0.7 + (i % 2) * 1.4, 2.4 + Math.floor(i / 2) * 2.0, 1.52);
    g.add(w);
  }
  g.userData.antenna = new THREE.Vector3(0, 10.9, 0);
  return g;
}

export { mat };
