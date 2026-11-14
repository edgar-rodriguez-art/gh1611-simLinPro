// @ts-check
// Adaptadores de conexión: PeerJS (WebRTC) y bucle local (modo demo y pruebas).

/**
 * @typedef {Object} Conn
 * @property {(obj:any)=>void} send
 * @property {(fn:(data:any)=>void)=>void} onMessage
 * @property {(fn:()=>void)=>void} onClose
 * @property {()=>void} close
 * @property {boolean} open
 */

/** Envuelve un DataConnection de PeerJS. */
export function peerConn(dc) {
  /** @type {((d:any)=>void)[]} */
  const msgFns = [];
  /** @type {(()=>void)[]} */
  const closeFns = [];
  const c = {
    open: true,
    send(obj) {
      if (!c.open) return;
      try {
        dc.send(JSON.stringify(obj));
      } catch {
        // la conexión puede haberse cerrado
      }
    },
    onMessage(fn) {
      msgFns.push(fn);
    },
    onClose(fn) {
      closeFns.push(fn);
    },
    close() {
      c.open = false;
      try {
        dc.close();
      } catch {
        /* nada */
      }
    },
  };
  dc.on('data', (d) => msgFns.forEach((f) => f(d)));
  const closed = () => {
    if (!c.open && closeFns.length === 0) return;
    c.open = false;
    closeFns.splice(0).forEach((f) => f());
  };
  dc.on('close', closed);
  dc.on('error', closed);
  return c;
}

/** Crea dos extremos conectados en memoria. Serializa a JSON para imitar la red. */
export function loopbackPair() {
  /** @type {any} */
  let a;
  /** @type {any} */
  let b;
  const make = () => {
    /** @type {((d:any)=>void)[]} */
    const msgFns = [];
    /** @type {(()=>void)[]} */
    const closeFns = [];
    const end = {
      open: true,
      peer: /** @type {any} */ (null),
      send(obj) {
        if (!end.open) return;
        const s = JSON.stringify(obj);
        const other = end.peer;
        queueMicrotask(() => other.open && other._deliver(s));
      },
      _deliver(s) {
        msgFns.forEach((f) => f(s));
      },
      onMessage(fn) {
        msgFns.push(fn);
      },
      onClose(fn) {
        closeFns.push(fn);
      },
      close() {
        if (!end.open) return;
        end.open = false;
        closeFns.splice(0).forEach((f) => f());
        end.peer.close();
      },
    };
    return end;
  };
  a = make();
  b = make();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

/** Opciones de PeerJS: servidor gratuito PeerJS Cloud + STUN de Google. */
export const PEER_OPTIONS = {
  debug: 0,
  config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
};

/** Mensaje claro en español para errores de PeerJS. */
export function describePeerError(err) {
  const type = err && err.type;
  switch (type) {
    case 'peer-unavailable':
      return 'No se encontró la sala. Revisa el código o pide al anfitrión que la vuelva a crear.';
    case 'unavailable-id':
      return 'El código de sala ya está en uso. Se generará otro.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'No hay conexión con el servidor de señalización (0.peerjs.com). Revisa Internet o el cortafuegos.';
    case 'webrtc':
    case 'negotiation-failed':
      return 'La red bloquea WebRTC (UDP). Prueba a conectar todos los dispositivos al punto de acceso de un móvil, o usa el modo demo local.';
    case 'browser-incompatible':
      return 'Este navegador no admite WebRTC. Usa una versión reciente de Chrome, Edge, Firefox o Safari.';
    default:
      return 'Error de red: ' + (err && err.message ? err.message : String(err));
  }
}
