// @ts-check
// Escena 3D low-poly isométrica. Todo lo animado sale del estado o de los eventos del motor.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PALETTE, SECTOR_COLOR } from './palette.js';
import { SECTOR_IDS, SECTORS, ALL_SLOTS, ROLE_LABELS, INSPECTION } from '../config.js';
import {
  uv,
  stationPos,
  slotPos,
  truckCurve,
  shipCurve,
  supplyCurve,
  LANE_YAW,
  LANE_V,
  COL_U,
  DEPOT,
  HOST_POS,
} from './layout.js';
import { board, roads, trees, mountains, lake, networkArcs } from './builders/terrain.js';
import * as B from './builders/buildings.js';
import { truck } from './builders/vehicles.js';
import { badge, iconSprite } from './builders/labels.js';
import { countTriangles } from './builders/common.js';
import { MoverPool, Smoke, Rings, progressBar } from './animations.js';

const DOCK_OFFSET = { bakery: -2.4, textile: 0, electronics: 2.4 };
const LABEL_Y = 3.6;

/**
 * @param {HTMLElement} container
 * @param {{mobile?:boolean, reduced?:boolean}} opts
 */
export function createWorld(container, opts = {}) {
  const mobile = !!opts.mobile;
  const reduced = !!opts.reduced;
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.0 : 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Escena 3D de la cadena de suministro');

  const scene = new THREE.Scene();

  // Cámara isométrica: 45° de giro y ~35° de elevación
  const VIEW = 44;
  const camera = new THREE.OrthographicCamera(-VIEW, VIEW, VIEW, -VIEW, 0.1, 400);
  const el = THREE.MathUtils.degToRad(35);
  const az = Math.PI / 4;
  const dist = 120;
  camera.position.set(Math.cos(el) * Math.sin(az) * dist, Math.sin(el) * dist, Math.cos(el) * Math.cos(az) * dist);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reduced;
  controls.dampingFactor = 0.12;
  controls.minZoom = 0.8;
  controls.maxZoom = 3.2;
  controls.minPolarAngle = THREE.MathUtils.degToRad(90 - 48);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(90 - 26);
  controls.minAzimuthAngle = az - 0.55;
  controls.maxAzimuthAngle = az + 0.55;
  controls.screenSpacePanning = true;
  controls.target.set(0, 0, 0);
  const clampTarget = () => {
    const t = controls.target;
    t.y = 0;
    const r = Math.hypot(t.x, t.z);
    if (r > 20) t.multiplyScalar(20 / r);
  };
  controls.addEventListener('change', clampTarget);

  // Luces: direccional cálida con sombras suaves + hemisférica lila
  scene.add(new THREE.HemisphereLight(0xcdbdff, 0xf0a04b, 1.25));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.9);
  sun.position.set(30, 45, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 512 : 1024, mobile ? 512 : 1024);
  sun.shadow.camera.left = -38;
  sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38;
  sun.shadow.camera.bottom = -38;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  // Terreno y decorado
  scene.add(board(), roads(), trees(), mountains(), lake());

  // Edificios
  const place = (obj, p, yaw = LANE_YAW) => {
    obj.position.copy(p);
    obj.rotation.y = yaw;
    scene.add(obj);
    return obj;
  };
  const suppliers = {
    bakery: place(B.windmill(), stationPos('supplier', 'bakery')),
    textile: place(B.cottonFarm(), stationPos('supplier', 'textile')),
    electronics: place(B.containers(), stationPos('supplier', 'electronics')),
  };
  const producers = {
    bakery: place(B.bakery(), stationPos('producer', 'bakery')),
    textile: place(B.textileMill(), stationPos('producer', 'textile')),
    electronics: place(B.electronicsPlant(), stationPos('producer', 'electronics')),
  };
  const depot = place(B.warehouse(), uv(DEPOT.u, DEPOT.v));
  const shops = Object.fromEntries(SECTOR_IDS.map((s) => [s, place(B.shop(SECTOR_COLOR[s]), stationPos('buyer', s))]));
  const host = place(B.hostTower(), uv(HOST_POS.u, HOST_POS.v));
  const antennaPos = uv(HOST_POS.u, HOST_POS.v, 10.9);

  // Arcos de red hacia los puestos
  scene.add(networkArcs(ALL_SLOTS.map((s) => slotPos(s).setY(3.5))));

  // Insignias Humano/BOT
  /** @type {Record<string, ReturnType<typeof badge>>} */
  const badges = {};
  for (const slot of ALL_SLOTS) {
    const [role, sector] = slot.split('-');
    const b = badge({ title: `${ROLE_LABELS[role]} · ${SECTORS[sector].label}`, subtitle: 'BOT', color: roleColor(role, sector), icon: 'bot' });
    // La altura se proyecta hacia arriba en pantalla: las etiquetas van bajas y delante del edificio
    const base = role === 'distributor' ? null : stationPos(role, sector);
    const p = base ? base.add(uv(0, -2.2, LABEL_Y)) : uv(DEPOT.u - 1.2 + SECTOR_IDS.indexOf(sector) * 2.6, DEPOT.v - 3.6, LABEL_Y - 0.9 + SECTOR_IDS.indexOf(sector) * 0.9);
    b.sprite.position.copy(p);
    scene.add(b.sprite);
    badges[slot] = b;
  }
  const supplierBadges = SECTOR_IDS.map((s) => {
    const b = badge({ title: `Proveedor · ${SECTORS[s].supplierLabel}`, subtitle: 'BOT · A / B / C', color: 0x8a86a3, icon: 'bot' });
    const p = stationPos('supplier', s).add(uv(0, -2.4, LABEL_Y - 0.6));
    b.sprite.position.copy(p);
    b.sprite.scale.multiplyScalar(0.8);
    scene.add(b.sprite);
    return b;
  });
  const hostBadge = badge({ title: 'ANFITRIÓN · Servidor', subtitle: 'métricas · Monte Carlo · propuestas', color: PALETTE.host, icon: 'host' });
  hostBadge.sprite.position.copy(uv(HOST_POS.u, HOST_POS.v, 12.6));
  scene.add(hostBadge.sprite);

  // Barras de progreso e iconos de avería
  /** @type {Record<string, ReturnType<typeof progressBar>>} */
  const bars = {};
  /** @type {Record<string, THREE.Sprite>} */
  const warn = {};
  for (const s of SECTOR_IDS) {
    const bar = progressBar(PALETTE.material);
    bar.group.position.copy(producers[s].localToWorld(producers[s].userData.bar.clone()));
    bar.group.visible = false;
    scene.add(bar.group);
    bars[s] = bar;
    const w = iconSprite('warning', '#e0403a');
    w.position.copy(stationPos('producer', s)).setY(producers[s].userData.top - 0.6);
    w.position.add(uv(1.6, 0.8));
    w.visible = false;
    scene.add(w);
    warn[s] = w;
  }

  // Camiones (máx. 6 por distribuidor) y furgonetas de lotes
  /** @type {Record<string, THREE.Group[]>} */
  const trucks = {};
  /** @type {Record<string, Record<string, THREE.CatmullRomCurve3>>} */
  const routes = {};
  for (const s of SECTOR_IDS) {
    trucks[s] = Array.from({ length: 6 }, () => {
      const t = truck(SECTOR_COLOR[s], 0.95);
      t.visible = false;
      scene.add(t);
      return t;
    });
    routes[s] = Object.fromEntries(SECTOR_IDS.map((b) => [b, truckCurve(s, b)]));
  }
  const vans = SECTOR_IDS.flatMap((s) =>
    Array.from({ length: 3 }, () => {
      const v = truck(SECTOR_COLOR[s], 0.7);
      v.visible = false;
      v.userData.sector = s;
      v.userData.busy = null;
      scene.add(v);
      return v;
    }),
  );
  const shipRoutes = Object.fromEntries(SECTOR_IDS.map((s) => [s, shipCurve(s)]));
  const supplyRoutes = Object.fromEntries(SECTOR_IDS.map((s) => [s, supplyCurve(s)]));

  // Pilas de cajas en los andenes (inventario del distribuidor)
  const crateGeo = new THREE.BoxGeometry(0.45, 0.45, 0.45);
  crateGeo.translate(0, 0.225, 0);
  const crates = new THREE.InstancedMesh(crateGeo, new THREE.MeshLambertMaterial({ color: PALETTE.material, flatShading: true }), 30);
  crates.castShadow = true;
  scene.add(crates);

  // Cajas, monedas, humo y ondas
  const boxes = new MoverPool(new THREE.BoxGeometry(0.42, 0.42, 0.42), PALETTE.wheat, 60);
  const coinGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.08, 10);
  const coins = new MoverPool(coinGeo, PALETTE.coin, 80, 0x4a3300);
  const smoke = new Smoke(reduced ? 0 : 40);
  const rings = new Rings(12);
  scene.add(boxes.mesh, coins.mesh, smoke.mesh, rings.group);

  // Destellos de propuesta: luz puntual temporal
  const flashLight = new THREE.PointLight(0xffe08a, 0, 12, 1.5);
  scene.add(flashLight);
  let flashUntil = 0;

  const state = { lastTraffic: 0, smokeAt: Object.fromEntries(SECTOR_IDS.map((s) => [s, 0])), speedMul: 1, last: performance.now() };

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    const v = aspect < 1 ? VIEW * 1.05 : VIEW * 0.5;
    camera.left = -v * aspect;
    camera.right = v * aspect;
    camera.top = v;
    camera.bottom = -v;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  /**
   * Actualiza la escena con la vista del estado (formato de snapshot) y el tiempo simulado (horas).
   * @param {any} view
   * @param {number} simT
   * @param {{speed:number, paused:boolean, room?:any}} clock
   */
  function update(view, simT, clock) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - state.last) / 1000);
    state.last = now;
    const running = !clock.paused;
    const speed = running ? clock.speed : 0;

    for (const s of SECTOR_IDS) {
      const P = view['P.' + s];
      if (!P) continue;
      const par = P.params;
      // tasa de producción relativa (con inspección y mantenimiento)
      const rate = P.status === 'run' ? (1 - INSPECTION[par.inspection].slowdown) * (1 - par.maintenance / 100) : 0;
      const omega = rate * speed * (reduced ? 0.3 : 1) * 2.2;
      for (const sp of producers[s].userData.spin) sp.obj.rotation[sp.axis] += omega * sp.k * dt;
      // el proveedor gira mientras tiene pedidos en camino
      const supOmega = (P.inbound > 0 ? 0.8 : 0.12) * speed * (reduced ? 0.3 : 1);
      for (const sp of suppliers[s].userData.spin) sp.obj.rotation[sp.axis] += supOmega * sp.k * dt;
      // barra de progreso del lote y humo
      const bar = bars[s];
      bar.group.visible = !!P.lot;
      bar.group.quaternion.copy(camera.quaternion);
      if (P.lot) bar.set(P.lot[2] ? 0.02 : P.lot[0] / P.lot[1]);
      if (rate > 0 && running && !reduced && now - state.smokeAt[s] > 380 / Math.max(0.5, speed)) {
        state.smokeAt[s] = now;
        smoke.emit(producers[s].localToWorld(producers[s].userData.smoke.clone()), now);
      }
      warn[s].visible = P.status === 'down';
      if (warn[s].visible) warn[s].material.rotation = Math.sin(now / 200) * 0.15;
    }

    // Camiones del distribuidor según su estado (salida, llegada, regreso)
    let ci = 0;
    const o = new THREE.Object3D();
    for (const s of SECTOR_IDS) {
      const D = view['D.' + s];
      if (!D) continue;
      const pool = trucks[s];
      pool.forEach((t) => (t.visible = false));
      D.trucks.forEach((tr, i) => {
        const t = pool[i];
        if (!t || tr.status === 'idle' || !tr.dest) return;
        const curve = routes[s][tr.dest];
        let k;
        if (tr.status === 'out') k = (simT - tr.departAt) / Math.max(0.01, tr.arriveAt - tr.departAt);
        else k = 1 - (simT - tr.arriveAt) / Math.max(0.01, tr.returnAt - tr.arriveAt);
        k = Math.min(1, Math.max(0, k));
        const p = curve.getPointAt(k);
        const tan = curve.getTangentAt(k);
        if (tr.status === 'return') tan.negate();
        const side = tr.status === 'return' ? 0.32 : -0.32;
        t.position.copy(p).add(new THREE.Vector3(-tan.z, 0, tan.x).multiplyScalar(side));
        t.rotation.y = Math.atan2(-tan.z, tan.x);
        t.userData.cargo.visible = tr.status === 'out' && tr.qty > 0;
        t.visible = true;
      });
      // pila de cajas en el andén: una caja ≈ medio día de demanda (máx. 10)
      const n = Math.min(10, Math.round(D.stock / Math.max(1, SECTORS[s].lambda * 0.5)));
      for (let i = 0; i < 10; i++, ci++) {
        if (i < n) {
          o.position.copy(uv(DEPOT.u + DOCK_OFFSET[s] - 0.5 + (i % 3) * 0.5, DEPOT.v + 3.0 - Math.floor(i / 3) * 0.0, Math.floor(i / 3) * 0.47));
          o.position.add(uv(0, 0));
          o.scale.setScalar(1);
        } else o.scale.setScalar(0);
        o.updateMatrix();
        crates.setMatrixAt(ci, o.matrix);
      }
    }
    crates.instanceMatrix.needsUpdate = true;

    // Furgonetas productor → centro logístico (eventos ship_to_dist)
    for (const v of vans) {
      const b = v.userData.busy;
      if (!b) continue;
      const k = (simT - b.t0) / Math.max(0.3, b.t1 - b.t0);
      if (k >= 1 || k < 0) {
        v.visible = false;
        v.userData.busy = null;
        continue;
      }
      const curve = shipRoutes[v.userData.sector];
      const p = curve.getPointAt(k);
      const tan = curve.getTangentAt(k);
      v.position.copy(p);
      v.rotation.y = Math.atan2(-tan.z, tan.x);
      v.visible = true;
    }

    boxes.update(now);
    coins.update(now);
    smoke.update(now);
    rings.update(now);
    flashLight.intensity = now < flashUntil ? 30 * Math.abs(Math.sin((now - flashUntil) / 120)) : 0;

    // Insignias Humano/BOT
    const slots = view.slots || {};
    const room = clock.room;
    for (const slot of ALL_SLOTS) {
      const [role, sector] = slot.split('-');
      const ctl = slots[slot]?.controller || 'bot';
      const r = room?.slots?.[slot];
      const human = ctl === 'human';
      badges[slot].update({
        title: `${ROLE_LABELS[role]} · ${SECTORS[sector].label}`,
        subtitle: human ? `Humano · ${r?.alias || 'jugador'}${r && !r.connected ? ' (desconectado)' : ''}` : slots[slot]?.conservative ? 'BOT conservador' : 'BOT',
        color: roleColor(role, sector),
        icon: human ? 'human' : 'bot',
      });
    }
    void supplierBadges;
    void hostBadge;

    controls.update();
    renderer.render(scene, camera);
  }

  /** Eventos del motor → animaciones. */
  function onEvents(events) {
    const now = performance.now();
    const dur = reduced ? 300 : 1500;
    for (const ev of events) {
      const s = ev.sector;
      switch (ev.type) {
        case 'input_delivery':
          for (let i = 0; i < 3; i++) boxes.add({ curve: supplyRoutes[s], start: now + i * 220, dur: dur + 300, lift: 0.25 });
          break;
        case 'ship_to_dist': {
          const v = vans.find((x) => x.userData.sector === s && !x.userData.busy);
          if (v) v.userData.busy = { t0: ev.t, t1: ev.arriveAt || ev.t + 2 };
          break;
        }
        case 'payment': {
          let from;
          let to;
          if (ev.to === 'supplier') {
            from = stationPos('producer', s);
            to = stationPos('supplier', s);
          } else if (ev.to === 'producer') {
            from = uv(DEPOT.u + DOCK_OFFSET[s], DEPOT.v + 2);
            to = stationPos('producer', s);
          } else {
            from = stationPos('buyer', ev.buyer || s);
            to = uv(DEPOT.u + DOCK_OFFSET[s], DEPOT.v - 2);
          }
          const n = Math.min(4, 1 + Math.floor(Math.log10(Math.max(1, ev.amount))));
          for (let i = 0; i < n; i++)
            coins.add({ from: from.clone().setY(1.2), to: to.clone().setY(1.2), start: now + i * 140, dur: dur, arc: 2.6, spin: 1 });
          break;
        }
        case 'lot_done':
          if (!reduced) rings.spawn(stationPos('producer', s).setY(0.3), now, { color: PALETTE.material, dur: 900, max: 2.5 });
          break;
        case 'proposal_flash':
          flash(ev.slot);
          break;
        default:
      }
    }
  }

  function flash(slot) {
    const now = performance.now();
    const p = slotPos(slot);
    rings.spawn(p.clone().setY(0.4), now, { color: PALETTE.money, dur: 1600, max: 4 });
    rings.spawn(p.clone().setY(0.4), now + 300, { color: PALETTE.money, dur: 1600, max: 4 });
    flashLight.position.copy(p).setY(4);
    flashUntil = now + 2400;
  }

  /** Onda en la antena del anfitrión por tráfico de red (limitada a ~3 por segundo). */
  function traffic() {
    const now = performance.now();
    if (reduced || now - state.lastTraffic < 330) return;
    state.lastTraffic = now;
    rings.spawn(antennaPos, now, { color: PALETTE.network, dur: 1100, max: 2.2 });
  }

  /** Centra la cámara en un puesto. */
  function focus(slot) {
    const p = slot === 'host' ? uv(HOST_POS.u, HOST_POS.v) : slotPos(slot);
    controls.target.copy(p.setY(0));
    camera.zoom = 1.7;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function resetView() {
    controls.target.set(0, 0, 0);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function dispose() {
    ro.disconnect();
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    update,
    onEvents,
    traffic,
    flash,
    focus,
    resetView,
    dispose,
    triangles: () => countTriangles(scene),
    renderer,
    scene,
    camera,
    _unused: { host, shops, depot, LANE_V, COL_U },
  };
}

function roleColor(role, sector) {
  if (role === 'distributor') return PALETTE.distributorRoof;
  return SECTOR_COLOR[sector];
}
