// Online rooms for 2 or 3 players on different devices.
// The host's browser runs the match; guests send their moves and get the board back.
const Online = (() => {
  const TEAMS = ['red', 'blue', 'purple'];
  const TEAM_LABELS = { red: 'Red', blue: 'Blue', purple: 'Purple' };
  const BROADCAST_MS = 50;   // board updates sent to guests ~20 times a second

  // { role: 'host' | 'guest', code, size, started, seats: [{ team, name, host, conn }], me, lobby }
  let room = null;
  let lastBroadcast = 0;
  let size = 2;

  const $ = id => document.getElementById(id);

  function cleanName(n) {
    return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16);
  }

  function busy(on) {
    $('create-room').disabled = on;
    $('join-room').disabled = on;
  }

  // ---------- room size ----------

  function renderSize() {
    for (const chip of document.querySelectorAll('#size-chips .chip')) {
      chip.classList.toggle('selected', Number(chip.dataset.size) === size);
      chip.setAttribute('aria-pressed', Number(chip.dataset.size) === size);
    }
  }

  $('size-chips').addEventListener('click', evt => {
    const chip = evt.target.closest('[data-size]');
    if (!chip) return;
    size = Number(chip.dataset.size);
    renderSize();
  });

  // ---------- lobby ----------

  function lobbyState() {
    return {
      t: 'lobby',
      code: room.code,
      started: room.started,
      seats: room.seats.map(s => ({ team: s.team, name: s.name, host: s.host, filled: !!(s.host || s.conn) })),
    };
  }

  function renderLobby() {
    const info = room.role === 'host' ? lobbyState() : room.lobby;
    if (!info) return;
    $('room-code-display').innerHTML = '';
    for (const ch of info.code) {
      const span = document.createElement('span');
      span.textContent = ch;
      $('room-code-display').append(span);
    }
    const list = $('seats');
    list.innerHTML = '';
    for (const seat of info.seats) {
      const li = document.createElement('li');
      li.className = seat.team + (seat.filled ? '' : ' empty');
      const nameEl = document.createElement('span');
      nameEl.className = 'seat-name';
      nameEl.textContent = seat.filled ? seat.name : 'Waiting for a player…';
      const tag = document.createElement('span');
      tag.className = 'seat-tag';
      const mine = room.role === 'host' ? seat.host : seat.team === room.me;
      tag.textContent = [TEAM_LABELS[seat.team], seat.host ? 'host' : '', mine ? 'you' : ''].filter(Boolean).join(' · ');
      li.append(nameEl, tag);
      list.append(li);
    }
    const guests = info.seats.filter(s => !s.host && s.filled).length;
    const empty = info.seats.filter(s => !s.filled).length;
    if (room.role === 'host') {
      $('lobby-note').textContent = guests
        ? (empty ? 'You can start now. The computer plays any empty seat, or wait for more players.' : 'Everyone is here. Start when you are ready.')
        : 'Send this code to your friends. They open the game, choose Online and type the code.';
      $('start-online').hidden = false;
      $('start-online').disabled = guests === 0;
      $('start-online').textContent = empty && guests ? 'Start (computer fills empty seats) →' : 'Start match →';
    } else {
      const host = info.seats.find(s => s.host);
      $('lobby-note').textContent = `Waiting for ${host ? host.name : 'the host'} to start the match.`;
      $('start-online').hidden = true;
    }
  }

  // ---------- host ----------

  async function createRoom() {
    if (!Net.available()) {
      Home.onlineMessage("Online play couldn't load. Check your internet connection and reload the page.");
      return;
    }
    const name = Home.myName();
    busy(true);
    Home.onlineMessage('Creating a room…');
    let code;
    try {
      code = await Net.host(onHostEvent);
    } catch (e) {
      busy(false);
      Home.onlineMessage(e.message);
      return;
    }
    busy(false);
    Home.onlineMessage('');
    room = {
      role: 'host',
      code,
      size,
      started: false,
      seats: TEAMS.slice(0, size).map((team, i) => ({ team, name: i === 0 ? name : null, host: i === 0, conn: null })),
    };
    renderLobby();
    Home.showLobby();
  }

  function onHostEvent(ev) {
    if (!room || room.role !== 'host') return;
    if (ev.type === 'message') {
      const msg = ev.msg || {};
      if (!ev.active) {
        if (msg.t === 'hello') admit(ev.from, msg);
        return;
      }
      const seat = room.seats.find(s => s.conn === ev.from);
      if (!seat) return;
      if (msg.t === 'leave') seatLeft(seat);
      else Game.applyRemote(seat.team, msg);
    } else if (ev.type === 'left') {
      const seat = room.seats.find(s => s.conn === ev.from);
      if (seat) seatLeft(seat);
    }
  }

  function admit(conn, msg) {
    if (room.started) {
      Net.reject(conn, { t: 'full', message: 'That match has already started. Ask the host for a new room.' });
      return;
    }
    const seat = room.seats.find(s => !s.host && !s.conn);
    if (!seat) {
      Net.reject(conn, { t: 'full', message: 'That room is full.' });
      return;
    }
    seat.conn = conn;
    seat.name = cleanName(msg.name) || TEAM_LABELS[seat.team];
    // two players with the same name would be confusing
    if (room.seats.some(s => s !== seat && s.name && s.name.toLowerCase() === seat.name.toLowerCase())) {
      seat.name += ` (${TEAM_LABELS[seat.team]})`;
    }
    Net.accept(conn);
    Net.send({ t: 'welcome', team: seat.team }, conn);
    Net.send(lobbyState());
    renderLobby();
  }

  function seatLeft(seat) {
    const name = seat.name;
    seat.conn = null;
    if (!room.started) {
      seat.name = null;
      Net.send(lobbyState());
      renderLobby();
      return;
    }
    Game.takeOver(seat.team);
    $('status').textContent = `${name} left the game, so the computer plays their army.`;
  }

  function startMatch() {
    if (!room || room.role !== 'host' || room.started) return;
    room.started = true;
    const teams = room.seats.map(s => s.team);
    const names = {}, remote = {}, cpu = {};
    for (const s of room.seats) {
      if (s.host) names[s.team] = s.name;
      else if (s.conn) { names[s.team] = s.name; remote[s.team] = true; }
      else { names[s.team] = 'Computer'; cpu[s.team] = true; }
    }
    document.body.classList.remove('online-guest');
    Home.showGame();
    Game.start({ mode: 'online', teams, names, remote, cpu, level: 'normal', onTick: broadcast });
    Net.send(lobbyState());
  }

  function broadcast() {
    const now = performance.now();
    if (now - lastBroadcast < BROADCAST_MS) return;
    lastBroadcast = now;
    Net.send({ t: 'state', s: Game.snapshot() });
  }

  // ---------- guest ----------

  async function joinRoom() {
    if (!Net.available()) {
      Home.onlineMessage("Online play couldn't load. Check your internet connection and reload the page.");
      return;
    }
    const code = Net.normaliseCode($('room-code').value);
    const name = Home.myName();
    busy(true);
    Home.onlineMessage(`Joining room ${code}…`);
    try {
      await Net.join(code, onGuestEvent);
    } catch (e) {
      busy(false);
      Home.onlineMessage(e.message);
      return;
    }
    busy(false);
    room = { role: 'guest', code, started: false, me: null, lobby: null };
    Net.send({ t: 'hello', name });
  }

  function onGuestEvent(ev) {
    if (!room || room.role !== 'guest') return;
    if (ev.type === 'left') {
      endRoom(room.started ? 'Lost the connection to the host, so the match has ended.' : 'Lost the connection to the room.');
      return;
    }
    if (ev.type !== 'message') return;
    const msg = ev.msg || {};
    if (msg.t === 'welcome') {
      room.me = msg.team;
      Home.onlineMessage('');
      Home.showLobby();
    } else if (msg.t === 'full' || msg.t === 'ended') {
      endRoom(msg.message);
    } else if (msg.t === 'lobby') {
      room.lobby = msg;
      if (!room.started) renderLobby();
    } else if (msg.t === 'state' && room.me) {
      if (!room.started) {
        room.started = true;
        document.body.classList.add('online-guest');
        Home.showGame();
        Game.join(room.me, action => Net.send(action));
      }
      Game.load(msg.s);
    }
  }

  // ---------- leaving ----------

  function endRoom(message) {
    Net.close();
    room = null;
    document.body.classList.remove('online-guest');
    Game.leave();
    Home.showHome();
    Home.onlineMessage(message);
  }

  function leave() {
    if (!room) return;
    Net.send(room.role === 'host' ? { t: 'ended', message: 'The host closed the room.' } : { t: 'leave' });
    Net.close(300);
    room = null;
    document.body.classList.remove('online-guest');
    Game.leave();
    Home.showHome();
    Home.onlineMessage('');
  }

  $('create-room').addEventListener('click', createRoom);
  $('join-room').addEventListener('click', joinRoom);
  $('room-code').addEventListener('keydown', evt => { if (evt.key === 'Enter') joinRoom(); });
  $('start-online').addEventListener('click', startMatch);
  $('leave-room').addEventListener('click', leave);
  $('leave-room-home').addEventListener('click', leave);
  // tell the others when this tab closes
  window.addEventListener('pagehide', () => { if (room) leave(); });

  renderSize();

  return {
    inRoom: () => !!room,
    leave,
    get room() { return room; },
  };
})();
