# CLAUDE.md — SimLinPro · Simulación Low-Poly de Líneas de Producción

> Este archivo contiene las reglas que Claude Code (Web) debe seguir para desarrollar, desplegar y mejorar la simulación.
> Léelo completo al inicio de cada sesión. Si alguna instrucción del usuario contradice este archivo, sigue la del usuario y propón actualizar este archivo en el mismo PR.

- **Repositorio:** `edgar-rodriguez-art/gh1611-simLinPro` (público).
- **URL de despliegue:** `https://edgar-rodriguez-art.github.io/gh1611-simLinPro/`
- **Diagrama de referencia visual y funcional:** `docs/diagrama-simulacion.png`. Es la fuente de verdad para la composición de la escena, la paleta y los flujos.
- **Idioma:** toda la interfaz, los comentarios de dominio, los commits y los informes se escriben en **español**. Los identificadores de código van en inglés.
- **Moneda:** EUR. **País de referencia:** España (`ES` / `ESP`).
- **Uso previsto:** clase de 45 a 60 min. El anfitrión proyecta la escena desde un portátil o PC de escritorio; los jugadores entran desde el móvil o un portátil.

---

## 1. Qué es el juego (resumen)

Es una cadena de suministro de 3 sectores (panadería, textil, ensamble electrónico) que se simula **en tiempo real continuo**. Se representa con una escena 3D low-poly isométrica.

```
Proveedor (BOT) ──insumos──▶ Productor ──lotes──▶ Distribuidor ──entregas──▶ Comprador
        ◀──────── pagos EUR ───────── ◀──── pagos EUR ──── ◀──── pagos EUR ────
                           ▲ propuestas de mejora (Monte Carlo) ▲
                                       ANFITRIÓN (servidor)
                    ▲ métricas reales de España (Eurostat + Banco Mundial)
```

| Rol | Puestos | Quién lo ocupa | Función |
|---|---|---|---|
| **Anfitrión** | 1 (obligatorio, humano) | Docente o facilitador | Crea la sala. Su navegador es el **servidor autoritativo**. Ve todas las métricas, ejecuta Monte Carlo, propone mejoras y controla la velocidad. |
| **Productor** | 3 (panadería, textil, electrónica) | Humano o BOT | Compra insumos a proveedores bot y vende lotes al distribuidor. Cambia sus parámetros de producción. |
| **Distribuidor** | 3 (uno por sector) | Humano o BOT | Compra al productor, almacena, vende y **entrega** al comprador con su flota. Los tres comparten el centro logístico; cada uno tiene su propio andén y flota. |
| **Comprador** | 3 (cesta inicial orientada a pan, textil y electrónica) | Humano o BOT | Elige qué compra (pan, textil o electrónica, en cualquier combinación) y cambia sus parámetros de compra. |
| **Proveedor** | 3 (harina, algodón, componentes), 2 o 3 opciones por sector | Siempre BOT | Ofrece precio, plazo y calidad ligados a los datos de Eurostat. |

Máximo de personas: **10** (1 anfitrión + 9 jugadores). Todo puesto vacío o desconectado lo ocupa un **BOT** automáticamente (§5).

---

## 2. Stack técnico (obligatorio)

- **Vite** + **JavaScript ES modules** (sin framework de UI; DOM y CSS propios). TypeScript solo vía JSDoc (`// @ts-check`) si ayuda.
- **Three.js** (npm `three`) para la escena 3D, con `OrbitControls` limitados.
- **PeerJS** (npm `peerjs`) para WebRTC con el servidor de señalización **gratuito PeerJS Cloud** (`0.peerjs.com`). No requiere cuenta. STUN: `stun:stun.l.google.com:19302`.
- **uPlot** o **Chart.js** (el más ligero que sirva) para las gráficas del panel del anfitrión.
- **Web Worker** para Monte Carlo (`src/sim/montecarlo.worker.js`).
- **Vitest** para pruebas unitarias y de reproducción. **ESLint** + **Prettier**.
- **Despliegue:** GitHub Actions → GitHub Pages (`actions/deploy-pages`). En `vite.config.js`, `base: '/gh1611-simLinPro/'`.
- Prohibido: backends propios, servicios que exijan cuenta o clave, `eval`, guardar secretos en el repo, cargar modelos 3D externos (toda la geometría es procedural).

---

## 3. Estructura del repositorio

```
/
├─ CLAUDE.md                     ← este archivo
├─ README.md                     ← qué es, cómo jugar, enlace a Pages
├─ CHANGELOG.md                  ← versiones (SemVer) y cambios por PR
├─ docs/
│  ├─ diagrama-simulacion.png    ← referencia visual (no borrar)
│  ├─ CONFIGURACION_GITHUB.md    ← pasos manuales del usuario
│  └─ protocolo.md               ← mensajes de red (se genera al implementar)
├─ data/
│  └─ metrics.json               ← caché de métricas de España (la actualiza una Action)
├─ logs/
│  ├─ README.md                  ← cómo subir bitácoras
│  ├─ analisis/                  ← informes que genera Claude (§10)
│  │  └─ indice.json             ← bitácoras ya procesadas
│  └─ *.json                     ← bitácoras subidas por los jugadores
├─ scripts/
│  ├─ fetch-metrics.mjs          ← descarga Eurostat/Banco Mundial → data/metrics.json
│  └─ analyze-logs.mjs           ← valida y agrega bitácoras (§10)
├─ src/
│  ├─ main.js                    ← arranque y enrutado lobby/juego
│  ├─ config.js                  ← constantes, rangos de parámetros, paleta
│  ├─ net/                       ← host.js, client.js, protocol.js (esquemas y validación)
│  ├─ sim/                       ← engine.js, entities/, rng.js, kpi.js, bots.js, montecarlo.worker.js, proposals.js
│  ├─ data/                      ← metrics.js (Eurostat → caché → Banco Mundial → por defecto)
│  ├─ scene/                     ← world.js, builders/ (terreno, edificios, camiones, árboles), animations.js, palette.js
│  ├─ ui/                        ← lobby.js, hud-*.js por rol, host-dashboard.js, proposal-modal.js, styles.css
│  └─ log/                       ← logger.js, schema.js (JSON Schema de bitácora)
├─ tests/                        ← *.test.js (motor, MC, protocolo, bitácoras, replay)
├─ index.html
├─ vite.config.js
├─ package.json
└─ .github/workflows/
   ├─ deploy.yml                 ← build + Pages en push a main
   ├─ metrics.yml                ← cron diario: scripts/fetch-metrics.mjs y commit de data/metrics.json
   └─ ci.yml                     ← lint + test en PR
```

---

## 4. Motor de simulación

### 4.1 Tiempo
- **Tiempo real continuo**, sin turnos. El reloj por defecto es **1 día simulado = 60 s reales**. El anfitrión puede elegir ×0.5, ×1, ×2 o ×4 y también pausar en caso de emergencia (no se usa en el flujo normal).
- El paso interno es `tick = 1 hora simulada`. El host ejecuta el motor; los clientes solo interpolan.
- Duración por defecto: **40 días simulados**, unos 40 min. Configurable de 10 a 90.
- Un **PRNG con semilla** (`mulberry32`) genera todo lo aleatorio. Semilla + configuración + secuencia de cambios de parámetros = partida reproducible (necesario para §10).

### 4.2 Entidades y procesos estocásticos
| Proceso | Distribución | Parámetros base (se ajustan con datos reales, §6) |
|---|---|---|
| Demanda del comprador | Poisson(λ diario × índice sectorial / 100) | λ por defecto: pan 120, textil 40, electrónica 15 u/día |
| Plazo del proveedor | Lognormal(μ, σ) | por proveedor A/B/C: rápido-caro, medio, lento-barato |
| Defectos de producción | Binomial(n lote, p defecto) | p disminuye con el nivel de inspección y el mantenimiento |
| Averías | Exponencial(MTBF), reparación Triangular | el MTBF aumenta con el % de mantenimiento preventivo |
| Viaje del camión | Triangular(min, moda, max) horas | según distancia del carril |
| Precio de insumos | deriva mensual = IPCA España, ruido = volatilidad del índice | §6 |

### 4.3 Parámetros por rol (rangos que el host aplica con *clamp*)
| Rol | Parámetro | Rango | Por defecto |
|---|---|---|---|
| Productor | Turnos por día | 1–3 | 2 |
| | Tamaño de lote (u) | 10–500 (según sector) | pan 150, textil 60, electr. 20 |
| | Precio mayorista (EUR/u) | ±40 % del costo de referencia | costo × 1.25 |
| | Punto de reorden de insumos (días de cobertura) | 1–10 | 3 |
| | Proveedor elegido | A / B / C | B |
| | Nivel de inspección | bajo / medio / alto | medio |
| | Mantenimiento preventivo (% tiempo) | 0–15 % | 5 % |
| Distribuidor | Camiones | 1–6 | 2 |
| | Capacidad por camión (u) | según sector | — |
| | Salidas de ruta por día | 1–4 | 2 |
| | Margen de reventa (%) | 0–60 % | 20 % |
| | Política de inventario (s, Q) | s: 0–10 días; Q: 1–20 días | s=2, Q=4 |
| Comprador | Cesta (% pan / textil / electrónica) | suma 100 % | según puesto |
| | Demanda objetivo (u/día) | 50–200 % de la base | 100 % |
| | Precio máximo aceptado (EUR/u) | ±50 % de la referencia | ref × 1.3 |
| | Stock de seguridad (días) | 0–7 | 1 |
| | Frecuencia de pedido (días) | 1–7 | 1 |

### 4.4 KPI (los calcula `sim/kpi.js` y los ven anfitrión y jugadores)
OEE (disponibilidad × rendimiento × calidad) · lead time pedido→entrega (P50 y P95) · fill rate y OTIF · inventario medio y días de cobertura · costo unitario · ingresos, margen y caja · pedidos pendientes · utilización de flota · **efecto látigo** (varianza de pedidos / varianza de demanda, por eslabón).
La partida termina al cumplirse los días o si un jugador queda en caja negativa más de 5 días (quiebra). En ese caso un BOT conservador ocupa el puesto y se registra el evento.

---

## 5. Bots

- `sim/bots.js` implementa una política por rol: el productor usa reorden (s,Q) y ajusta el lote a la demanda media de 7 días; el distribuidor despacha cuando el camión llega al 80 % o vence el plazo; el comprador usa la demanda base con su stock de seguridad.
- Un bot **acepta una propuesta del anfitrión** solo si `P(mejora) ≥ 0.6` y el riesgo P5 no empeora más de un 5 %.
- Si un humano se desconecta más de 15 s, el bot toma su puesto **conservando los parámetros actuales**. Cuando vuelve, recupera el control.
- En la escena 3D, cada puesto muestra una insignia (sprite con icono SVG) **Humano** o **BOT**. El lobby y el HUD usan los mismos iconos.

---

## 6. Métricas reales de España (API sin cuenta)

Orden de respaldo en `src/data/metrics.js`: **(1)** Eurostat en vivo → **(2)** `data/metrics.json` (caché de la Action) → **(3)** Banco Mundial en vivo → **(4)** constantes de `config.js`. El panel del anfitrión muestra siempre **fuente y fecha** de cada dato.

**Eurostat** (JSON-stat 2.0; sin clave):
`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{DATASET}?{filtros}&lastTimePeriod=24`
| Uso en el modelo | Dataset y filtros | Notas verificadas |
|---|---|---|
| Índice de demanda por sector y su volatilidad | `sts_inpr_m` · `geo=ES` · `unit=I21` · `nace_r2=C10` (alimentos), `C13` (textil), `C26` (electrónica) | Pide **un `nace_r2` por petición**. `s_adj` no está para todos los sectores: prueba `SCA` → `CA` → `NSA`. C26 sin desestacionalizar tiene caídas en agosto (útil para la volatilidad). |
| Deriva de precios de insumos | `prc_hicp_manr` · `geo=ES` · `coicop=CP00` | Comprueba que la serie siga actualizada. Si el último periodo tiene más de 6 meses, busca el dataset sucesor en el catálogo de Eurostat y documéntalo aquí. |
| Precios industriales (opcional) | `sts_inppd_m` · `geo=ES` · mismos `nace_r2` | Valida códigos con `.../sdmx/3.0/structure/dataconstraint/ESTAT/STS_INPPD_M`. |

**Banco Mundial** (respaldo anual):
`https://api.worldbank.org/v2/country/ESP/indicator/{IND}?format=json&mrv=5`. Indicadores: `FP.CPI.TOTL.ZG` (IPC %) y `NV.IND.MANF.ZS` (manufactura % PIB).

**Cómo entran al modelo:** `λ_sector = λ_base × (último índice / 100)`; `σ_demanda` = desviación de las variaciones mensuales de los últimos 24 meses; costo de insumos × (1 + IPCA/12) por cada 30 días simulados.
`scripts/fetch-metrics.mjs` hace lo mismo en Node para la Action diaria. Si la red del entorno de Claude Code bloquea estos dominios, **no lo trates como un error del código**: prueba con fixtures en `tests/fixtures/` y deja la verificación en vivo a la Action.

---

## 7. Monte Carlo y propuestas del anfitrión

- Se ejecuta en un **Web Worker** con una copia del estado actual (*snapshot*) y simula un **horizonte de 14 días**. Usa **N = 1000** réplicas por defecto (configurable de 200 a 5000; máximo 3 s en un portátil medio, y si no alcanza, reduce N y avisa).
- Para cada jugador compara la **línea base** con **escenarios candidatos**: variaciones de un parámetro a la vez de ±10 % y ±20 % (o el valor siguiente o anterior si es discreto). Las combinaciones de 2 parámetros solo se prueban para el top 3.
- El resultado por candidato incluye la Δ esperada de los KPI clave del rol, P5/P50/P95, la probabilidad de mejora y el riesgo (empeoramiento en P5).
- El anfitrión ve un ranking y un histograma. **Él elige** qué propuesta enviar; nunca se envía sola.
- **Flujo:** `proposal` → el jugador ve un modal con *antes → después*, la Δ esperada y el riesgo → **Aceptar** o **Rechazar** (expira en 90 s reales; si expira, cuenta como rechazada). Solo si acepta, el host aplica los parámetros. Todo queda en la bitácora.
- Usa la **misma semilla base + índice de réplica** para que los resultados sean reproducibles.

---

## 8. Red en tiempo real (PeerJS)

- El anfitrión crea `new Peer('simlinpro-' + CODIGO)`, con `CODIGO` de 6 caracteres sin ambiguos (sin 0/O/1/I). Los jugadores se unen escribiendo el código o escaneando un **QR** que muestra el anfitrión.
- El **host es autoritativo**. Los clientes solo envían intenciones (`set_params`, `answer_proposal`, `chat`); el host valida, aplica *clamp* y responde.
- **Mensajes** (JSON, campo `v` de versión de protocolo y `t` de tipo): `hello`, `room_state`, `claim_role`, `role_granted`, `role_denied`, `set_params`, `params_applied`, `snapshot` (4 Hz, con deltas), `event` (eventos de animación), `proposal`, `answer_proposal`, `chat`, `ping`/`pong`, `game_over`, `log_request`. Valida cada mensaje entrante con el esquema de `net/protocol.js` y descarta lo que no cumpla.
- Latencia: `ping` cada 2 s, que se muestra en el HUD. Reconexión automática con el mismo `playerId` (guardado en `sessionStorage`).
- Si la conexión WebRTC falla (redes escolares que bloquean UDP), muestra un diagnóstico claro y la sugerencia de usar el punto de acceso del móvil. Ofrece el **modo demo local**: todos los roles en un mismo dispositivo, los demás como bots.
- Si el host cierra o recarga la pestaña, la partida termina para todos. Antes, el host guarda un *snapshot* en `localStorage` (con try/catch) para poder **reanudar**.

---

## 9. Escena 3D low-poly (debe respetar `docs/diagrama-simulacion.png`)

- **Cámara** isométrica: `OrthographicCamera` a 45° de giro y unos 35° de elevación. Zoom y giro limitados; botón "centrar en mi puesto".
- **Estilo:** `MeshLambertMaterial` o `MeshStandardMaterial` con `flatShading: true`, sin texturas. Luz direccional cálida con sombras suaves y luz hemisférica lila. Fondo con degradado lila → crema.
- **Paleta** (`scene/palette.js`): suelo `#f0a04b` y bordes `#d9822f`/`#b8661f` · agua `#3b8fe0` · árboles cono `#3d7fd6` · montañas `#e68a3e` y `#c9c6de` con nieve `#ffffff` · panadería `#d2553a` · textil `#8e6fd1` · electrónica `#2f80d1` · distribuidor `#4e6bd6`/`#f6d06b` · anfitrión `#5b3fb8` · flujo de material `#1f9d55` · dinero `#d99a00` · red `#7b4fd6`.
- **Disposición:** un tablero en rombo con **3 carriles horizontales** (panadería, textil, electrónica). En cada carril, de izquierda a derecha: proveedor → productor → centro logístico compartido (carretera transversal) → comprador. La torre del anfitrión va en la esquina trasera, el lago en la delantera y las montañas detrás.
- **Edificios:** molino con aspas y trigal (proveedor de harina); campo de algodón y silo; contenedores de componentes; panadería con chimenea; nave textil con tejado en diente de sierra; planta electrónica con techo azul; almacén con andenes; 3 tiendas con toldo; torre del anfitrión con antena.
- **Animaciones obligatorias**, todas derivadas de eventos del motor y nunca decorativas sin causa:
  - aspas o maquinaria girando a una velocidad proporcional a la tasa de producción;
  - cajas (`InstancedMesh`) que avanzan del proveedor al productor cuando llega un pedido de insumos;
  - humo o partículas y una barra de progreso del lote sobre el productor mientras produce; icono de avería si hay parada;
  - camiones que recorren las curvas del carril (`CatmullRomCurve3`) en cada entrega, con la carga visible;
  - monedas doradas que vuelven en sentido contrario en cada pago;
  - destello en el puesto que recibe una propuesta; ondas en la antena del anfitrión cuando hay tráfico de red.
- **Rendimiento:** menos de 60k triángulos, `pixelRatio` como máximo 1.5 (1.0 en móvil), 60 fps en escritorio y 30 fps o más en móvil de gama media. Respeta `prefers-reduced-motion`.

### UI
- **Lobby:** botones "Crear sala (anfitrión)" y "Unirse con código", más un mapa de puestos ocupados. Cada jugador elige rol y sector y escribe un alias (sin datos personales).
- **HUD por rol:** sliders y selectores de §4.3, KPI propios con miniaturas, caja en EUR, notificaciones y modal de propuesta.
- **Panel del anfitrión:** KPI de todos, fuente y fecha de los datos de España, Monte Carlo (histograma y ranking), envío de propuestas, velocidad, QR y código de sala, y botón "Pedir bitácoras a todos".
- **Móvil:** la escena arriba y el panel como *bottom sheet*; botones táctiles de 44 px o más.

---

## 10. Bitácoras y ciclo de mejora (`/logs`)

### 10.1 Generación (en el juego)
- Cada jugador y el anfitrión pueden pulsar **"Descargar bitácora"** en cualquier momento y al final de la partida. El host puede pedir las bitácoras a todos (`log_request`).
- **Nombre del archivo:** `AAAA-MM-DD_SALA_rol-sector_alias.json` (por ejemplo, `2026-11-20_K7P2QX_productor-textil_ana.json`). El del anfitrión: `..._anfitrion_alias.json`.
- **Esquema** (`src/log/schema.js`, JSON Schema, con `schemaVersion`):
  `schemaVersion`, `appVersion`, `commitSha`, `partidaId`, `sala`, `rol`, `sector`, `alias`, `semilla`, `config` (velocidad, días, N de MC), `fuenteDatos` (con fechas), `inicio`/`fin`,
  `parametros[]` (marca de tiempo simulada, valor anterior, nuevo valor y origen: jugador, propuesta o bot),
  `propuestas[]` (Δ esperada, P(mejora), decisión, tiempo de respuesta),
  `kpiDiarios[]`, `eventos[]` (averías, roturas de stock, quiebras),
  `red` (latencias P50/P95, desconexiones, mensajes rechazados), `rendimiento` (fps medio y mínimo, ms de MC),
  `errores[]` (de `window.onerror` y `unhandledrejection`, con *stack* recortado), `feedback` (valoración del 1 al 5 y texto libre del jugador).
  La bitácora del anfitrión incluye además el **registro completo de eventos** para poder repetir la partida. Tamaño máximo: 2 MB (compacta los KPI si se supera).
- **Privacidad:** no se guardan nombres reales, correos ni IP. El alias es libre.

### 10.2 Cuándo actúa Claude
Al iniciar una sesión, o cuando el usuario lo pida, Claude compara `logs/*.json` con `logs/analisis/indice.json`. Si hay bitácoras **nuevas**, ejecuta este procedimiento antes de cualquier otra tarea:

1. **Validar** cada bitácora con `node scripts/analyze-logs.mjs` (esquema y versión). Las inválidas se listan en el informe, pero **nunca se borran ni se modifican**.
2. **Agregar** las métricas por partida y versión de la app.
3. **Detectar problemas** con estos umbrales:

| Categoría | Señal | Umbral para actuar |
|---|---|---|
| Errores | `errores[]` | cualquier error repetido en 2 o más bitácoras, o 1 que rompa la partida |
| Red | desconexiones, latencia P95, mensajes rechazados | más de 2 desconexiones por jugador, P95 > 400 ms, o más del 1 % de mensajes rechazados |
| Rendimiento | fps medio en móvil o escritorio, ms de MC | < 30 fps en móvil, < 50 fps en escritorio, MC > 3 s |
| Sincronía | diferencias entre KPI del cliente y del host | más del 2 % |
| Balance del juego | quiebras, dominio de bots, KPI que no responden a parámetros | quiebra antes del día 10, bots > 30 % por encima de humanos en todos los KPI, o un parámetro sin efecto medible |
| Propuestas | tasa de aceptación y acierto | aceptación < 20 %, o propuestas aceptadas que empeoran el KPI en > 40 % de los casos |
| UX | `feedback` | valoración media < 3.5 o un mismo comentario en 3 o más jugadores |

4. **Reproducir** el problema: usa `semilla` y el registro de eventos del anfitrión para crear una prueba en `tests/replay/` que **falle antes** de la corrección.
5. **Escribir el informe** `logs/analisis/AAAA-MM-DD_informe.md` con: resumen ejecutivo, bitácoras analizadas, hallazgos (evidencia, archivo y evento, severidad P1/P2/P3), cambios propuestos y si cada uno **requiere aprobación**.
6. **Implementar** solo lo P1/P2 técnico (errores, red, rendimiento, sincronía, UX clara). Cambios de **reglas o balance** que modifiquen parámetros más de ±20 % o añadan mecánicas nuevas **no se implementan**: se dejan propuestos en el informe para que decida el usuario.
7. Sube la **versión** (PATCH para correcciones, MINOR para mejoras), actualiza `CHANGELOG.md` y añade las bitácoras procesadas a `logs/analisis/indice.json` (nombre, fecha, hash SHA-256, informe).
8. Abre un **PR** titulado `mejora: análisis de bitácoras AAAA-MM-DD` con el informe enlazado.
9. Si ningún umbral se supera, el informe concluye **"No requiere mejora de funcionamiento"**, se actualiza `indice.json` y no se toca el código.

---

## 11. Acciones de GitHub que Claude Code Web debe hacer por sí mismo

En la primera sesión, sin esperar confirmación, Claude debe:
1. Crear toda la estructura de §3, `package.json`, configuración de Vite, ESLint y Prettier, y `.gitignore` (`node_modules`, `dist`).
2. Crear los workflows:
   - `deploy.yml`: en `push` a `main` y `workflow_dispatch`, ejecuta `npm ci`, `npm test` y `npm run build` (con `VITE_COMMIT_SHA=${{ github.sha }}`), y después `actions/upload-pages-artifact` y `actions/deploy-pages`. Permisos: `pages: write`, `id-token: write`.
   - `metrics.yml`: `schedule: '17 5 * * *'` y `workflow_dispatch`. Ejecuta `node scripts/fetch-metrics.mjs` y hace commit de `data/metrics.json` solo si cambió. Permiso: `contents: write`.
   - `ci.yml`: lint y pruebas en cada PR.
3. Crear `logs/README.md`, `logs/analisis/indice.json` (`[]`), `data/metrics.json` inicial (valores por defecto marcados `"fuente": "por-defecto"`) y `docs/protocolo.md`.
4. Trabajar en una rama `claude/...`, hacer commits pequeños y descriptivos en español, hacer *push* y **abrir el Pull Request** hacia `main` con un resumen y una lista de verificación. Si los permisos lo permiten, deja el PR listo para fusionar.
5. Al terminar, decir al usuario qué pasos manuales quedan, remitiendo a `docs/CONFIGURACION_GITHUB.md`: activar Pages con GitHub Actions como fuente, permisos de escritura de Actions y fusionar el PR.

Claude **no** puede ni debe: cambiar la configuración del repositorio, crear tokens ni secretos, ni borrar bitácoras.

---

## 12. Calidad y definición de terminado

- `npm test` en verde. Pruebas mínimas: el motor es determinista con la misma semilla; los KPI salen correctos en casos simples calculados a mano; MC devuelve percentiles estables (±2 % entre ejecuciones con N=2000); el protocolo rechaza mensajes inválidos; el bot ocupa el puesto tras la desconexión; la bitácora generada valida contra el esquema; el replay reproduce los KPI del anfitrión.
- `npm run build` sin advertencias. El bundle principal pesa menos de 900 KB gzip.
- **Prueba manual:** abre dos pestañas (anfitrión y productor) y comprueba que la conexión funciona, que cambiar un parámetro mueve la animación y el KPI, y que una propuesta enviada y aceptada aplica el cambio. Revisa también el modo demo local y la descarga de bitácora.
- Antes del PR, toma capturas de la escena con Playwright si está disponible y compáralas con el diagrama (paleta, carriles, posición de los edificios).
- Muestra la versión y el `commitSha` en el pie del lobby.
- No dejes `console.log` de depuración. Los mensajes de usuario van en español claro.
