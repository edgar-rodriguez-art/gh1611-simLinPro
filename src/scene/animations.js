// @ts-check
// Animaciones derivadas de eventos del motor: cajas de insumos, monedas de pago, humo y ondas.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const tmp = new THREE.Object3D();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** Pool de objetos instanciados que recorren una curva o un arco entre dos puntos. */
export class MoverPool {
  /**
   * @param {THREE.BufferGeometry} geo
   * @param {number} color
   * @param {number} cap
   */
  constructor(geo, color, cap, emissive = 0) {
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshLambertMaterial({ color, flatShading: true, emissive }),
      cap,
    );
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.cap = cap;
    /** @type {any[]} */
    this.items = [];
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, HIDDEN);
  }

  /** @param {{curve?:THREE.Curve<THREE.Vector3>, from?:THREE.Vector3, to?:THREE.Vector3, start:number, dur:number, arc?:number, spin?:number}} it */
  add(it) {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push(it);
  }

  update(now) {
    this.items = this.items.filter((it) => now < it.start + it.dur);
    for (let i = 0; i < this.cap; i++) {
      const it = this.items[i];
      if (!it || now < it.start) {
        this.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      const k = Math.min(1, (now - it.start) / it.dur);
      if (it.curve) {
        it.curve.getPointAt(k, tmp.position);
        const tan = it.curve.getTangentAt(k);
        tmp.rotation.set(0, Math.atan2(-tan.z, tan.x), 0);
      } else {
        tmp.position.lerpVectors(it.from, it.to, k);
        tmp.position.y += Math.sin(Math.PI * k) * (it.arc || 2);
        tmp.rotation.set(Math.PI / 2, (now / 200) * (it.spin || 1), 0);
      }
      tmp.position.y += it.lift || 0;
      const s = k < 0.1 ? k / 0.1 : k > 0.9 ? (1 - k) / 0.1 : 1;
      tmp.scale.setScalar(Math.max(0.05, s));
      tmp.updateMatrix();
      this.mesh.setMatrixAt(i, tmp.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Humo: partículas que suben desde las chimeneas mientras el productor produce. */
export class Smoke {
  constructor(cap = 36) {
    const geo = new THREE.IcosahedronGeometry(0.28, 0);
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, flatShading: true }),
      cap,
    );
    this.mesh.frustumCulled = false;
    this.cap = cap;
    /** @type {{pos:THREE.Vector3, born:number}[]} */
    this.parts = [];
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, HIDDEN);
  }
  emit(pos, now) {
    if (this.parts.length >= this.cap) this.parts.shift();
    this.parts.push({ pos: pos.clone(), born: now });
  }
  update(now) {
    const life = 2600;
    this.parts = this.parts.filter((p) => now - p.born < life);
    for (let i = 0; i < this.cap; i++) {
      const p = this.parts[i];
      if (!p) {
        this.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      const k = (now - p.born) / life;
      tmp.position.set(p.pos.x + k * 0.8, p.pos.y + k * 2.4, p.pos.z - k * 0.4);
      tmp.rotation.set(k * 2, k * 3, 0);
      tmp.scale.setScalar(0.5 + k * 1.4);
      tmp.updateMatrix();
      this.mesh.setMatrixAt(i, tmp.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Ondas expansivas (antena del anfitrión y destello de propuestas). */
export class Rings {
  constructor(cap = 10) {
    this.group = new THREE.Group();
    /** @type {{mesh:THREE.Mesh, start:number, dur:number, max:number}[]} */
    this.items = [];
    this.pool = [];
    const geo = new THREE.TorusGeometry(1, 0.06, 4, 24).rotateX(Math.PI / 2);
    for (let i = 0; i < cap; i++) {
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: PALETTE.network, transparent: true, opacity: 0 }),
      );
      m.visible = false;
      this.group.add(m);
      this.pool.push(m);
    }
  }
  spawn(pos, now, { color = PALETTE.network, dur = 1200, max = 3 } = {}) {
    const m = this.pool.find((x) => !x.visible) || this.pool[0];
    m.visible = true;
    m.position.copy(pos);
    /** @type {THREE.MeshBasicMaterial} */ (m.material).color.setHex(color);
    this.items = this.items.filter((x) => x.mesh !== m);
    this.items.push({ mesh: m, start: now, dur, max });
  }
  update(now) {
    for (const it of this.items) {
      const k = (now - it.start) / it.dur;
      const mat = /** @type {THREE.MeshBasicMaterial} */ (it.mesh.material);
      if (k >= 1) {
        it.mesh.visible = false;
        continue;
      }
      it.mesh.scale.setScalar(0.3 + k * it.max);
      mat.opacity = 0.9 * (1 - k);
    }
    this.items = this.items.filter((it) => it.mesh.visible);
  }
}

/** Barra de progreso del lote (fondo + relleno). El grupo se orienta hacia la cámara en cada fotograma. */
export function progressBar(color) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.3),
    new THREE.MeshBasicMaterial({ color: 0x2b2540, transparent: true, opacity: 0.6, depthTest: false }),
  );
  const geo = new THREE.PlaneGeometry(2.3, 0.2);
  geo.translate(1.15, 0, 0);
  const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false }));
  fill.position.set(-1.15, 0, 0.01);
  bg.renderOrder = 12;
  fill.renderOrder = 13;
  g.add(bg, fill);
  return {
    group: g,
    set(k) {
      fill.scale.x = Math.max(0.001, Math.min(1, Math.max(0, k)));
    },
  };
}
