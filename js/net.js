/*
 * Online rooms, peer-to-peer over WebRTC (PeerJS), following Auction XI's net.js.
 *
 * The room creator ("host") runs the game; players who join ("guests") send
 * their moves to the host and receive the board back. Rooms are found through
 * the free PeerJS server using a 5-letter code. A host can hold several guests
 * (up to two, for a 3-player room).
 */
const Net = (() => {
  const PREFIX = 'piaoyao-battleboard-room-';
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: they look like 1 and 0
  const CODE_LENGTH = 5;
  const CONNECT_TIMEOUT = 15000;
  // WebRTC can take 30s+ to notice a vanished peer, so both sides send a
  // heartbeat and treat 10s of silence as a lost connection.
  const PING_EVERY = 2000, DROP_AFTER = 10000;

  let peer = null;
  let conns = new Set();   // accepted connections: the guests (host side) or the host (guest side)
  let heartbeat = null;
  let handler = () => {};

  const available = () => typeof window.Peer === 'function';
  const makeCode = () => Array.from({ length: CODE_LENGTH }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
  const normaliseCode = s => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH);

  function friendly(err) {
    const messages = {
      'peer-unavailable': 'Room not found. Check the code, or ask your friend to create a new room.',
      'network': 'Network problem. Check your internet connection.',
      'server-error': "Couldn't reach the room server. Try again in a moment.",
      'socket-error': "Couldn't reach the room server. Try again in a moment.",
      'browser-incompatible': "This browser can't play online. Try Chrome, Edge, Firefox or Safari.",
    };
    return new Error(messages[err && err.type] || (err && err.message) || 'Connection problem. Please try again.');
  }

  // Note when we last heard from a connection; heartbeats aren't passed on.
  function heard(c, msg) {
    c.lastSeen = Date.now();
    return !(msg && msg.t === 'ping');
  }

  function dropped(c) {
    if (!conns.has(c)) return;
    conns.delete(c);
    try { c.close(); } catch (e) { /* already closed */ }
    if (!conns.size) stopWatch();
    handler({ type: 'left', from: c });
  }

  function startWatch() {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
      for (const c of [...conns]) {
        if (Date.now() - c.lastSeen > DROP_AFTER) { dropped(c); continue; }
        try { c.send({ t: 'ping' }); } catch (e) { /* will time out */ }
      }
    }, PING_EVERY);
  }

  function stopWatch() {
    clearInterval(heartbeat);
    heartbeat = null;
  }

  function keepAlive(p) {
    // losing the signalling server doesn't drop an open game
    p.on('disconnected', () => { if (!p.destroyed) p.reconnect(); });
  }

  /**
   * Create a room. Resolves with its code. Anyone who connects is a visitor
   * until accept(from) is called; visitors' messages arrive with active: false.
   */
  function host(onEvent) {
    close();
    handler = onEvent;
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryCode = () => {
        const code = makeCode();
        const p = new window.Peer(PREFIX + code);
        let opened = false;
        p.on('open', () => { opened = true; peer = p; resolve(code); });
        p.on('error', err => {
          if (!opened && err.type === 'unavailable-id' && ++attempts < 8) { p.destroy(); tryCode(); }
          else if (!opened) { p.destroy(); reject(friendly(err)); }
          else handler({ type: 'error', message: friendly(err).message });
        });
        keepAlive(p);
        p.on('connection', c => {
          c.on('open', () => {
            c.lastSeen = Date.now();
            c.on('data', msg => { if (heard(c, msg)) handler({ type: 'message', msg, from: c, active: conns.has(c) }); });
            c.on('close', () => dropped(c));
            c.on('error', () => {});
          });
        });
      };
      tryCode();
    });
  }

  /** Host: take this visitor into the game. */
  function accept(c) {
    conns.add(c);
    c.lastSeen = Date.now();
    startWatch();
  }

  /** Host: turn a visitor away with a message. */
  function reject(c, msg) {
    try { c.send(msg); } catch (e) { /* gone already */ }
    setTimeout(() => { try { c.close(); } catch (e) { /* gone already */ } }, 400);
  }

  /** Join a room by code. Resolves once connected to the host. */
  function join(rawCode, onEvent) {
    close();
    handler = onEvent;
    const code = normaliseCode(rawCode);
    return new Promise((resolve, reject) => {
      if (code.length !== CODE_LENGTH) { reject(new Error(`Room codes are ${CODE_LENGTH} letters.`)); return; }
      let settled = false;
      const p = new window.Peer();
      peer = p;
      const fail = err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        close();
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error("Couldn't reach that room. Check the code and try again.")), CONNECT_TIMEOUT);
      p.on('open', () => {
        const c = p.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        c.on('open', () => {
          settled = true;
          clearTimeout(timer);
          c.lastSeen = Date.now();
          c.on('data', msg => { if (heard(c, msg)) handler({ type: 'message', msg, from: c, active: true }); });
          c.on('close', () => dropped(c));
          c.on('error', () => {});
          conns.add(c);
          startWatch();
          resolve(code);
        });
      });
      p.on('error', err => {
        if (!settled) fail(friendly(err));
        else handler({ type: 'error', message: friendly(err).message });
      });
      keepAlive(p);
    });
  }

  /** Send to one connection, or to everyone accepted. */
  function send(msg, to) {
    const targets = to ? [to] : conns;
    for (const c of targets) {
      if (c.open) { try { c.send(msg); } catch (e) { /* dropped; heartbeat will notice */ } }
    }
  }

  // Detach now; tear down after `delay` ms so a last message can still get out.
  function close(delay) {
    const cs = [...conns], p = peer;
    stopWatch();
    conns = new Set();
    peer = null;
    handler = () => {};
    const shut = () => {
      for (const c of cs) { try { c.close(); } catch (e) { /* already closed */ } }
      if (p && !p.destroyed) p.destroy();
    };
    if (delay) setTimeout(shut, delay); else shut();
  }

  return { CODE_LENGTH, available, normaliseCode, host, accept, reject, join, send, close };
})();
