# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y [SemVer](https://semver.org/lang/es/).

## [1.0.0] - 2026-11-14

### Añadido
- Motor de simulación horario y determinista (mulberry32): proveedores BOT A/B/C, productores por lotes con averías (exponencial), reparación (triangular) y defectos (binomial), distribuidores con flota y política (s, Q), compradores con demanda Poisson.
- KPI: OEE, lead time P50/P95, fill rate, OTIF, inventario y cobertura, costo unitario, margen, caja, pendientes, utilización de flota y efecto látigo por eslabón.
- Bots por rol, toma del puesto tras 15 s de desconexión y BOT conservador tras quiebra (más de 5 días con caja negativa).
- Red PeerJS con anfitrión autoritativo, validación de mensajes, snapshots a 4 Hz con deltas, ping/latencia, reconexión con el mismo `playerId` y guardado para reanudar.
- Monte Carlo en Web Workers: cribado de candidatos (±10 %/±20 % o valor vecino), top 3 con combinaciones, presupuesto de 3 s (reduce N y avisa), P(mejora), P5/P50/P95 y riesgo.
- Propuestas del anfitrión con modal de aceptar/rechazar (90 s); los BOT aceptan si P(mejora) ≥ 0,6 y el riesgo P5 ≤ 5 %.
- Métricas de España: Eurostat → caché → Banco Mundial → valores por defecto; Action diaria `metrics.yml`.
- Escena 3D low-poly según el diagrama, con animaciones derivadas de eventos del motor (aspas, cajas, humo y barra de lote, camiones, monedas, destellos y ondas de red).
- Lobby, HUD por rol, panel del anfitrión (KPI, datos, Monte Carlo, propuestas, bitácoras), modo demo local y diseño móvil con *bottom sheet*.
- Bitácoras JSON con esquema, `scripts/analyze-logs.mjs` con los umbrales de §10.2 y prueba de replay.
- Workflows de CI, despliegue en GitHub Pages y métricas.
