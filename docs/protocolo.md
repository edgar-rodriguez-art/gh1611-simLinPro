# Protocolo de red (v1)

Transporte: PeerJS (WebRTC DataChannel fiable, serialización `raw` con JSON). Señalización: PeerJS Cloud (`0.peerjs.com`), STUN `stun:stun.l.google.com:19302`.
El anfitrión registra el id `simlinpro-CODIGO` (6 caracteres sin 0/O/1/I). **El anfitrión es autoritativo**: los clientes solo envían intenciones.

Todo mensaje es un objeto JSON con `v` (versión de protocolo = 1) y `t` (tipo). Se valida con `src/net/protocol.js`; lo que no cumple se descarta y se cuenta como rechazado.

## Cliente → anfitrión

| `t` | Campos | Respuesta |
|---|---|---|
| `hello` | `playerId` (≤64), `alias` (≤20), `appVersion?` | `room_state`; si ya tenía puesto, `role_granted` (reconexión) |
| `claim_role` | `slot` (`producer-bakery`, `distributor-textile`, `buyer-electronics`…) | `role_granted` o `role_denied` |
| `set_params` | `changes` (1–10 claves; números o cadenas ≤10) | el anfitrión aplica *clamp* y difunde `params_applied` |
| `answer_proposal` | `id`, `accept` | se aplica si `accept` y queda en la bitácora |
| `chat` | `text` (≤300) | difusión de `chat` |
| `ping` | `ts` | `pong` con el mismo `ts` (cada 2 s) |

## Anfitrión → clientes

| `t` | Campos | Notas |
|---|---|---|
| `room_state` | `room`, `slots` {controller, alias, connected}, `started`, `speed`, `day`, `days`, `paused` | al cambiar la sala |
| `role_granted` | `slot`, `playerId`, `params` | |
| `role_denied` | `slot`, `reason` | puesto ocupado o sala llena (9 jugadores) |
| `params_applied` | `slot`, `changes`, `origin` (`jugador`, `propuesta`, `bot`) | |
| `snapshot` | `simT` (h), `speed`, `paused`, `full`, `data` | 4 Hz; `data` con claves planas (`meta`, `slots`, `P.<sector>`, `D.<sector>`, `B.<sector>`, `kpi`, `kpiHist`). Solo se envían las claves que cambiaron; completo cada 5 s |
| `event` | `events[]` | eventos del motor para animar: `input_order`, `input_delivery`, `lot_start`, `lot_done`, `breakdown`, `repair`, `ship_to_dist`, `dist_receive`, `buyer_order`, `truck_depart`, `truck_arrive`, `truck_return`, `payment`, `stockout`, `price_rejected`, `controller`, `bankrupt`, `proposal_flash`, `game_over` |
| `proposal` | `id`, `slot`, `changes`, `before`, `delta` {profit, k1, k2}, `pImprove`, `riskP5`, `ttlMs`, `kpiLabel?` | expira a los 90 s (cuenta como rechazada) |
| `chat` | `text`, `from?` | |
| `pong` | `ts` | |
| `game_over` | `summary` | |
| `log_request` | — | el cliente descarga su bitácora |

## Reglas

- Desconexión: si un humano no responde 15 s, un BOT toma el puesto conservando sus parámetros. Al volver con el mismo `playerId` (guardado en `sessionStorage`) recupera el control.
- Si el anfitrión cierra o recarga, la partida termina; el estado se guarda en `localStorage` para reanudarla.
- Interpolación: el cliente avanza `simT` con la velocidad recibida hasta el siguiente snapshot (máx. 1,5 h).
