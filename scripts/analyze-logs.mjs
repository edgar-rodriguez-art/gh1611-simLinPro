#!/usr/bin/env node
// Valida y agrega las bitácoras de logs/*.json y comprueba los umbrales de CLAUDE.md §10.2.
// Nunca modifica ni borra bitácoras.
//
// Uso:
//   node scripts/analyze-logs.mjs                 → resumen de bitácoras nuevas (no listadas en indice.json)
//   node scripts/analyze-logs.mjs --all           → analiza todas
//   node scripts/analyze-logs.mjs --json          → salida JSON (para automatizar)
//   node scripts/analyze-logs.mjs --report        → escribe el borrador logs/analisis/AAAA-MM-DD_informe.md
//   node scripts/analyze-logs.mjs --update-index  → añade las bitácoras analizadas a indice.json
//   --dir <carpeta>                               → otra carpeta de bitácoras (pruebas)
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLog } from '../src/log/schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);

export const THRESHOLDS = {
  disconnectsPerPlayer: 2,
  latencyP95: 400,
  rejectedRatio: 0.01,
  fpsMobile: 30,
  fpsDesktop: 50,
  mcMs: 3000,
  syncDiff: 0.02,
  bankruptcyDay: 10,
  botAdvantage: 0.3,
  acceptanceMin: 0.2,
  acceptedWorseMax: 0.4,
  feedbackMin: 3.5,
  sameCommentMin: 3,
};

/** Analiza una lista de { file, log, sha } ya leídas. Función pura (exportada para pruebas). */
export function analyze(entries) {
  const valid = [];
  const invalid = [];
  for (const e of entries) {
    if (e.parseError) {
      invalid.push({ file: e.file, errores: [e.parseError] });
      continue;
    }
    const errs = validateLog(e.log);
    if (errs.length) invalid.push({ file: e.file, errores: errs.slice(0, 10) });
    else valid.push(e);
  }

  const findings = [];
  const add = (categoria, severidad, titulo, evidencia, requiereAprobacion = false) =>
    findings.push({ categoria, severidad, titulo, evidencia, requiereAprobacion });

  // Errores repetidos en 2+ bitácoras o fatales
  const errMap = new Map();
  for (const { file, log } of valid) {
    for (const er of log.errores) {
      const key = er.mensaje.replace(/\d+/g, 'N').slice(0, 160);
      if (!errMap.has(key)) errMap.set(key, new Set());
      errMap.get(key).add(file);
      if (er.fatal) add('Errores', 'P1', `Error que rompe la partida: ${er.mensaje}`, [file]);
    }
  }
  for (const [msg, files] of errMap) {
    if (files.size >= 2)
      add('Errores', 'P1', `Error repetido en ${files.size} bitácoras: ${msg}`, [...files]);
  }

  // Red y rendimiento por jugador
  for (const { file, log } of valid) {
    const r = log.red;
    if (r.desconexiones > THRESHOLDS.disconnectsPerPlayer)
      add('Red', 'P2', `${r.desconexiones} desconexiones`, [file]);
    if (r.latenciaP95 !== null && r.latenciaP95 > THRESHOLDS.latencyP95)
      add('Red', 'P2', `Latencia P95 de ${r.latenciaP95} ms`, [file]);
    if (r.mensajesRecibidos > 0 && r.mensajesRechazados / r.mensajesRecibidos > THRESHOLDS.rejectedRatio)
      add(
        'Red',
        'P2',
        `${((100 * r.mensajesRechazados) / r.mensajesRecibidos).toFixed(1)} % de mensajes rechazados`,
        [file],
      );
    const p = log.rendimiento;
    const minFps = p.dispositivo === 'movil' ? THRESHOLDS.fpsMobile : THRESHOLDS.fpsDesktop;
    if (p.fpsMedio !== null && p.fpsMedio < minFps)
      add('Rendimiento', 'P2', `${p.fpsMedio} fps de media en ${p.dispositivo}`, [file]);
    for (const ms of p.mcMs)
      if (ms > THRESHOLDS.mcMs) add('Rendimiento', 'P2', `Monte Carlo tardó ${ms} ms`, [file]);
  }

  // Por partida
  const games = new Map();
  for (const e of valid) {
    const g = games.get(e.log.partidaId) || { host: null, players: [] };
    if (e.log.rol === 'anfitrion') g.host = e;
    else g.players.push(e);
    games.set(e.log.partidaId, g);
  }
  const perGame = [];
  for (const [id, g] of games) {
    const summary = {
      partidaId: id,
      appVersion: (g.host || g.players[0]).log.appVersion,
      jugadores: g.players.length,
      conAnfitrion: !!g.host,
    };
    perGame.push(summary);
    if (!g.host) continue;
    const host = g.host.log;
    const hostDays = new Map(host.kpiDiarios.map((k) => [k.dia, k.puestos || {}]));

    // Sincronía cliente ↔ anfitrión
    for (const p of g.players) {
      for (const k of p.log.kpiDiarios) {
        const hk = hostDays.get(k.dia)?.[k.puesto];
        if (!hk || !k.kpi) continue;
        for (const [name, v] of Object.entries(k.kpi)) {
          const hv = hk[name];
          if (typeof v !== 'number' || typeof hv !== 'number') continue;
          const diff = Math.abs(v - hv) / Math.max(1, Math.abs(hv));
          if (diff > THRESHOLDS.syncDiff) {
            add('Sincronía', 'P1', `KPI ${name} del día ${k.dia} difiere ${(diff * 100).toFixed(1)} %`, [
              p.file,
              g.host.file,
            ]);
            break;
          }
        }
      }
    }

    // Balance: quiebras tempranas
    for (const ev of host.eventos) {
      if (ev.tipo === 'quiebra' && (ev.dia ?? ev.t / 24) < THRESHOLDS.bankruptcyDay)
        add('Balance', 'P2', `Quiebra de ${ev.slot} el día ${ev.dia}`, [g.host.file], true);
    }
    // Balance: bots frente a humanos (último día, por rol)
    const last = host.kpiDiarios.at(-1)?.puestos || {};
    const humans = new Set(g.players.map((p) => `${toRole(p.log.rol)}-${toSector(p.log.sector)}`));
    for (const role of ['producer', 'distributor', 'buyer']) {
      const slots = Object.keys(last).filter((s) => s.startsWith(role));
      const h = slots.filter((s) => humans.has(s));
      const b = slots.filter((s) => !humans.has(s));
      if (!h.length || !b.length) continue;
      const metric = (ss, key) => ss.reduce((a, s) => a + (last[s][key] ?? 0), 0) / ss.length;
      const keys = ['cash', role === 'distributor' ? 'otif' : 'fillRate'];
      const allBetter = keys.every((k) => {
        const hv = metric(h, k);
        const bv = metric(b, k);
        return bv > hv * (1 + THRESHOLDS.botAdvantage) || (hv <= 0 && bv > 0);
      });
      if (allBetter)
        add(
          'Balance',
          'P3',
          `Los BOT superan a los humanos en más de un 30 % (${role})`,
          [g.host.file],
          true,
        );
    }

    // Propuestas
    const props = host.propuestas.filter((p) => p.decision !== 'pendiente');
    if (props.length >= 5) {
      const acc = props.filter((p) => p.decision === 'aceptada');
      const rate = acc.length / props.length;
      if (rate < THRESHOLDS.acceptanceMin)
        add('Propuestas', 'P3', `Tasa de aceptación del ${(rate * 100).toFixed(0)} %`, [g.host.file], true);
      let worse = 0;
      let measured = 0;
      for (const p of acc) {
        const d = Math.floor((p.t || 0) / 24);
        const before = avgMargin(host.kpiDiarios, p.puesto, d - 3, d - 1);
        const after = avgMargin(host.kpiDiarios, p.puesto, d + 1, d + 3);
        if (before === null || after === null) continue;
        measured++;
        if (after < before) worse++;
      }
      if (measured >= 3 && worse / measured > THRESHOLDS.acceptedWorseMax)
        add(
          'Propuestas',
          'P2',
          `${worse} de ${measured} propuestas aceptadas empeoraron el margen`,
          [g.host.file],
          true,
        );
    }
  }

  // UX: valoración media y comentarios repetidos
  const ratings = valid.map((e) => e.log.feedback?.valoracion).filter((x) => typeof x === 'number');
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  if (avgRating !== null && avgRating < THRESHOLDS.feedbackMin)
    add(
      'UX',
      'P2',
      `Valoración media ${avgRating.toFixed(2)}`,
      valid.map((e) => e.file),
    );
  const comments = new Map();
  for (const e of valid) {
    const t = (e.log.feedback?.texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]/g, '')
      .trim();
    if (t.length < 4) continue;
    comments.set(t, [...(comments.get(t) || []), e.file]);
  }
  for (const [t, files] of comments)
    if (files.length >= THRESHOLDS.sameCommentMin) add('UX', 'P2', `Comentario repetido: "${t}"`, files);

  const byVersion = {};
  for (const e of valid) byVersion[e.log.appVersion] = (byVersion[e.log.appVersion] || 0) + 1;

  return {
    analizadas: entries.length,
    validas: valid.length,
    invalidas: invalid,
    porVersion: byVersion,
    partidas: perGame,
    valoracionMedia: avgRating,
    hallazgos: findings,
    requiereMejora: findings.length > 0,
  };
}

function toRole(rol) {
  return { productor: 'producer', distribuidor: 'distributor', comprador: 'buyer' }[rol] || rol;
}
function toSector(s) {
  return { panaderia: 'bakery', textil: 'textile', electronica: 'electronics' }[s] || s;
}
function avgMargin(kpis, slot, from, to) {
  const vals = kpis
    .filter((k) => k.dia >= from && k.dia <= to)
    .map((k) => k.puestos?.[slot]?.margin)
    .filter((x) => typeof x === 'number');
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function renderReport(res, date, files) {
  const lines = [];
  lines.push(`# Informe de bitácoras · ${date}`, '');
  lines.push('## Resumen ejecutivo', '');
  if (!res.requiereMejora && !res.invalidas.length)
    lines.push('**No requiere mejora de funcionamiento.**', '');
  else
    lines.push(
      `Se detectaron ${res.hallazgos.length} hallazgos y ${res.invalidas.length} bitácoras inválidas.`,
      '',
    );
  lines.push('## Bitácoras analizadas', '');
  for (const f of files) lines.push(`- \`${f}\``);
  lines.push(
    '',
    `Válidas: ${res.validas} · Inválidas: ${res.invalidas.length} · Por versión: ${JSON.stringify(res.porVersion)}`,
    '',
  );
  if (res.invalidas.length) {
    lines.push('### Inválidas (no se modifican ni se borran)', '');
    for (const i of res.invalidas) lines.push(`- \`${i.file}\`: ${i.errores.join('; ')}`);
    lines.push('');
  }
  lines.push('## Hallazgos', '');
  if (!res.hallazgos.length) lines.push('Ningún umbral de §10.2 se supera.', '');
  lines.push(
    '| Severidad | Categoría | Hallazgo | Evidencia | Requiere aprobación |',
    '|---|---|---|---|---|',
  );
  for (const h of res.hallazgos)
    lines.push(
      `| ${h.severidad} | ${h.categoria} | ${h.titulo} | ${h.evidencia.map((e) => '`' + e + '`').join(', ')} | ${h.requiereAprobacion ? 'Sí' : 'No'} |`,
    );
  lines.push(
    '',
    '## Cambios propuestos',
    '',
    '_(Completar tras reproducir cada problema en `tests/replay/`.)_',
    '',
  );
  return lines.join('\n');
}

async function main() {
  const dir = path.resolve(root, opt('--dir') || 'logs');
  const indexPath = path.resolve(root, 'logs/analisis/indice.json');
  let index;
  try {
    index = JSON.parse(await readFile(indexPath, 'utf8'));
  } catch {
    index = [];
  }
  const known = new Set(index.map((x) => x.sha256));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const entries = [];
  for (const file of files) {
    const buf = await readFile(path.join(dir, file));
    const sha = createHash('sha256').update(buf).digest('hex');
    if (!has('--all') && known.has(sha)) continue;
    try {
      entries.push({ file, sha, log: JSON.parse(buf.toString('utf8')) });
    } catch (e) {
      entries.push({ file, sha, parseError: 'JSON inválido: ' + e.message });
    }
  }
  const res = analyze(entries);
  const date = new Date().toISOString().slice(0, 10);
  if (has('--json')) console.log(JSON.stringify(res, null, 2));
  else {
    console.log(
      `Bitácoras nuevas: ${entries.length} (válidas ${res.validas}, inválidas ${res.invalidas.length})`,
    );
    for (const i of res.invalidas) console.log(`  ✗ ${i.file}: ${i.errores[0]}`);
    for (const h of res.hallazgos) console.log(`  [${h.severidad}] ${h.categoria}: ${h.titulo}`);
    if (!res.hallazgos.length) console.log('  Ningún umbral superado.');
  }
  const reportName = `${date}_informe.md`;
  if (has('--report') && entries.length) {
    await mkdir(path.resolve(root, 'logs/analisis'), { recursive: true });
    await writeFile(
      path.resolve(root, 'logs/analisis', reportName),
      renderReport(
        res,
        date,
        entries.map((e) => e.file),
      ),
    );
    console.log('Informe: logs/analisis/' + reportName);
  }
  if (has('--update-index') && entries.length) {
    for (const e of entries)
      if (!known.has(e.sha)) index.push({ nombre: e.file, fecha: date, sha256: e.sha, informe: reportName });
    await writeFile(indexPath, JSON.stringify(index, null, 2) + '\n');
    console.log('indice.json actualizado.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
