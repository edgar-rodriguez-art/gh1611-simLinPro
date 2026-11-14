// @ts-check
// Insignias (sprites con icono Humano/BOT) y etiquetas de los puestos.
import * as THREE from 'three';
import { ICON_PATHS } from '../../ui/icons.js';

const W = 512;
const H = 128;

function hex(c) {
  return '#' + c.toString(16).padStart(6, '0');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Dibuja la tarjeta: barra de color, título, subtítulo e icono. */
function draw(canvas, { title, subtitle, color, icon }) {
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.clearRect(0, 0, W, H);
  ctx.shadowColor = 'rgba(40,20,90,0.25)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, 8, 8, W - 16, H - 16, 18);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = hex(color);
  roundRect(ctx, 8, 8, 14, H - 16, 7);
  ctx.fill();
  if (icon && typeof Path2D !== 'undefined') {
    ctx.save();
    ctx.translate(W - 96, 26);
    ctx.scale(3, 3);
    ctx.fillStyle = icon === 'bot' ? '#6b6585' : hex(color);
    ctx.fill(new Path2D(ICON_PATHS[icon]), icon === 'bot' ? 'evenodd' : 'nonzero');
    ctx.restore();
  }
  ctx.fillStyle = '#231d3a';
  ctx.font = '700 38px system-ui, sans-serif';
  ctx.fillText(title, 38, 58, W - 150);
  ctx.fillStyle = '#5c5675';
  ctx.font = '500 28px system-ui, sans-serif';
  ctx.fillText(subtitle, 38, 98, W - 150);
}

/** Crea una insignia actualizable. */
export function badge(info) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  draw(canvas, info);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(5.2, 1.3, 1);
  sprite.renderOrder = 10;
  let last = JSON.stringify(info);
  return {
    sprite,
    update(next) {
      const s = JSON.stringify(next);
      if (s === last) return;
      last = s;
      draw(canvas, next);
      tex.needsUpdate = true;
    },
  };
}

/** Icono flotante simple (avería). */
export function iconSprite(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(16, 14);
  ctx.scale(4, 4);
  ctx.fillStyle = color;
  if (typeof Path2D !== 'undefined') ctx.fill(new Path2D(ICON_PATHS[name]));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.3, 1.3, 1);
  s.renderOrder = 11;
  return s;
}
