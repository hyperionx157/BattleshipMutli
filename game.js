/* ═══════════════════════════════════════════════════════════════════
   BATTLESHIP MULTIPLAYER — game.js
   Architecture: PeerJS (WebRTC) peer-to-peer
   - Host creates a Peer with a room-code ID
   - Guest connects to that peer ID
   - All game state is synchronized via JSON messages
═══════════════════════════════════════════════════════════════════ */

'use strict';

// ── Constants ────────────────────────────────────────────────────
const SHIPS = [
  { type: 'carrier',    size: 5, name: 'Aircraft Carrier' },
  { type: 'battleship', size: 4, name: 'Battleship'       },
  { type: 'destroyer',  size: 3, name: 'Destroyer'        },
  { type: 'submarine',  size: 3, name: 'Submarine'        },
  { type: 'patrolboat', size: 2, name: 'Patrol Boat'      },
];
const GRID_SIZE = 10;
const DIRS = { H: 'h', V: 'v' };
const MSG = {
  HELLO:    'hello',     // exchange names
  READY:    'ready',     // fleet placement done, share layout
  FIRE:     'fire',      // shoot x,y
  FIRE_ACK: 'fire_ack',  // result of shot
  SUNK:     'sunk',      // announce which ship was sunk
  GAME_WIN: 'game_win',  // game over
  RESTART:  'restart',   // both players agree to restart
};

// ── Utility ──────────────────────────────────────────────────────
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length: 6}, () => chars[rnd(0, chars.length - 1)]).join('');
}
function cellId(x, y) { return `${x}-${y}`; }
function showToast(msg, type = '', dur = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ` toast-${type}` : '');
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), dur);
}

// ── Grid model ───────────────────────────────────────────────────
class Grid {
  constructor() {
    this.cells = Array.from({length: GRID_SIZE}, () => Array(GRID_SIZE).fill(0));
    // 0=empty 1=ship 2=miss 3=hit 4=sunk
  }
  get(x, y) { return this.cells[x][y]; }
  set(x, y, v) { this.cells[x][y] = v; }
  isShip(x, y) { return this.cells[x][y] === 1; }
  isHit(x, y)  { return this.cells[x][y] === 3; }
  isMiss(x, y) { return this.cells[x][y] === 2; }
  isAlreadyShot(x, y) { return this.cells[x][y] === 2 || this.cells[x][y] === 3 || this.cells[x][y] === 4; }
}

// ── Fleet model ──────────────────────────────────────────────────
class Fleet {
  constructor() {
    this.ships = SHIPS.map(s => ({
      ...s,
      cells: [],    // [{x,y}]
      hits: 0,
      sunk: false,
    }));
  }
  placeShip(type, x, y, dir, grid) {
    const ship = this.ships.find(s => s.type === type);
    const cells = [];
    for (let i = 0; i < ship.size; i++) {
      const cx = dir === DIRS.H ? x + i : x;
      const cy = dir === DIRS.V ? y + i : y;
      if (cx >= GRID_SIZE || cy >= GRID_SIZE) return false;
      if (grid.get(cx, cy) !== 0) return false;
      cells.push({x: cx, y: cy});
    }
    ship.cells = cells;
    cells.forEach(c => grid.set(c.x, c.y, 1));
    return true;
  }
  findShipAt(x, y) {
    return this.ships.find(s => s.cells.some(c => c.x === x && c.y === y));
  }
  recordHit(x, y) {
    const ship = this.findShipAt(x, y);
    if (!ship) return null;
    ship.hits++;
    if (ship.hits >= ship.size) {
      ship.sunk = true;
      return { ship, sunk: true };
    }
    return { ship, sunk: false };
  }
  allSunk() { return this.ships.every(s => s.sunk); }
  serialize() {
    return this.ships.map(s => ({ type: s.type, cells: s.cells }));
  }
  loadFromSerialized(data, grid) {
    data.forEach(sd => {
      const ship = this.ships.find(s => s.type === sd.type);
      ship.cells = sd.cells;
      sd.cells.forEach(c => grid.set(c.x, c.y, 1));
    });
  }
  countSunk() { return this.ships.filter(s => s.sunk).length; }
  markSunk(type, grid) {
    const ship = this.ships.find(s => s.type === type);
    if (!ship) return;
    ship.sunk = true;
    ship.hits = ship.size;
    ship.cells.forEach(c => grid.set(c.x, c.y, 4));
  }
}

// ── UI helpers ───────────────────────────────────────────────────
function buildGridDOM(gridEl) {
  gridEl.innerHTML = '';
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = x;
      cell.dataset.y = y;
      gridEl.appendChild(cell);
    }
  }
}

function getCell(gridEl, x, y) {
  return gridEl.querySelector(`[data-x="${x}"][data-y="${y}"]`);
}

function setCellState(gridEl, x, y, state) {
  const cell = getCell(gridEl, x, y);
  if (!cell) return;
  cell.className = 'cell ' + state;
  if (state === 'hit') {
    cell.classList.add('hit-anim');
    setTimeout(() => cell.classList.remove('hit-anim'), 700);
  }
}

function markSunkOnGrid(gridEl, cells) {
  cells.forEach(c => setCellState(gridEl, c.x, c.y, 'sunk'));
}

function addLog(msg, cls = '') {
  const ul = document.getElementById('battle-log');
  const li = document.createElement('li');
  li.textContent = msg;
  if (cls) li.className = cls;
  ul.prepend(li);
  // Keep max 40 entries
  while (ul.children.length > 40) ul.removeChild(ul.lastChild);
}

function updateStats(state) {
  document.getElementById('stat-shots').textContent = state.myShots;
  document.getElementById('stat-hits').textContent  = state.myHits;
  const acc = state.myShots > 0 ? Math.round(100 * state.myHits / state.myShots) + '%' : '—';
  document.getElementById('stat-acc').textContent   = acc;
  document.getElementById('stat-sunk').textContent  = state.enemySunk + ' / 5';
}

function setTurnIndicator(isMyTurn, waiting) {
  const el = document.getElementById('header-turn');
  if (waiting) {
    el.textContent = '⌛ WAITING FOR OPPONENT';
    el.className = 'header-turn';
    return;
  }
  if (isMyTurn) {
    el.textContent = '🎯 YOUR TURN — FIRE!';
    el.className = 'header-turn your-turn';
  } else {
    el.textContent = '⚓ ENEMY TURN...';
    el.className = 'header-turn enemy-turn';
  }
}

// ══════════════════════════════════════════════════════════════════
//  MAIN GAME CONTROLLER
// ══════════════════════════════════════════════════════════════════

const App = (function() {

  // ── State ──────────────────────────────────────────────────────
  let peer = null;
  let conn = null;
  let isHost = false;
  let myName = '';
  let oppName = '';
  let myFleet  = null;
  let myGrid   = null;   // grid model for my field
  let oppGrid  = null;   // what i know of enemy field
  let oppFleet = null;   // used by host to adjudicate shots against guest

  // Guest sends their fleet; host adjudicates. 
  // In pure P2P both sides trust each other. We send fleet layout on READY.
  let isMyTurn   = false;
  let gameActive = false;
  let placingShip = null;  // { type, size }
  let placeDir    = DIRS.H;
  let placedTypes = new Set();
  let myRestartReady   = false;
  let oppRestartReady  = false;

  // Stats
  let myShots  = 0;
  let myHits   = 0;
  let enemySunk = 0;

  // DOM refs
  const gridHuman = document.getElementById('grid-human');
  const gridEnemy = document.getElementById('grid-enemy');
  const logEl     = document.getElementById('battle-log');

  // ── Network ────────────────────────────────────────────────────
  function sendMsg(type, data = {}) {
    if (conn && conn.open) {
      conn.send(JSON.stringify({ type, ...data }));
    }
  }

  function onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }

    switch (msg.type) {
      case MSG.HELLO:
        oppName = msg.name;
        document.getElementById('header-opp-name').textContent = oppName;
        showToast(`${oppName} connected!`, 'success');
        // If host just connected, greet back and start placement
        if (isHost) {
          sendMsg(MSG.HELLO, { name: myName });
          startPlacement();
        }
        break;

      case MSG.READY:
        // Opponent finished placing. Load their fleet.
        oppFleet = new Fleet();
        oppFleet.loadFromSerialized(msg.fleet, oppGrid);
        // Check if we are also ready
        if (placedTypes.size === SHIPS.length && !gameActive) {
          checkBothReady();
        } else {
          showToast('Opponent is ready! Finish placing your ships.', '', 3500);
        }
        oppReady = true;
        break;

      case MSG.FIRE:
        handleIncomingFire(msg.x, msg.y);
        break;

      case MSG.FIRE_ACK:
        handleFireAck(msg.x, msg.y, msg.result, msg.ship);
        break;

      case MSG.SUNK:
        handleEnemySunk(msg.ship);
        break;

      case MSG.GAME_WIN:
        handleGameOver(false);
        break;

      case MSG.RESTART:
        oppRestartReady = true;
        if (myRestartReady) doRestart();
        else showToast('Opponent wants a rematch! Click Play Again.', '', 5000);
        break;
    }
  }

  let oppReady = false;

  function checkBothReady() {
    if (oppReady && placedTypes.size === SHIPS.length) {
      startGame();
    }
  }

  // ── Host flow ──────────────────────────────────────────────────
  function hostGame(name) {
    myName = name;
    isHost = true;
    const roomCode = genRoomCode();

    // Use a random peer ID that encodes the room code
    const peerId = 'bship-' + roomCode;
    peer = new Peer(peerId, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ]
      }
    });

    peer.on('open', id => {
      document.getElementById('room-code-display').classList.remove('hidden');
      document.getElementById('room-code-value').textContent = roomCode;
      document.getElementById('waiting-text').textContent = '⏳ Awaiting opponent…';
    });

    peer.on('connection', c => {
      conn = c;
      setupConn();
    });

    peer.on('error', err => {
      console.error(err);
      // If ID taken, try again with a new code
      if (err.type === 'unavailable-id') {
        peer.destroy();
        hostGame(name);
      } else {
        showToast('Connection error: ' + err.message, 'error');
      }
    });
  }

  // ── Guest flow ─────────────────────────────────────────────────
  function joinGame(name, code) {
    myName = name;
    isHost = false;
    const peerId = 'bship-' + code.toUpperCase().trim();

    peer = new Peer(undefined, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ]
      }
    });

    peer.on('open', () => {
      document.getElementById('join-error').classList.add('hidden');
      conn = peer.connect(peerId, { reliable: true });
      setupConn();
    });

    peer.on('error', err => {
      document.getElementById('join-error').classList.remove('hidden');
      showToast('Failed to connect. Check the room code.', 'error');
    });
  }

  function setupConn() {
    conn.on('open', () => {
      // Transition to game screen
      document.getElementById('screen-lobby').classList.remove('active');
      document.getElementById('screen-lobby').classList.add('hidden');
      document.getElementById('screen-game').classList.remove('hidden');
      document.getElementById('screen-game').classList.add('active');

      document.getElementById('header-you-name').textContent = myName;

      // Build grids
      buildGridDOM(gridHuman);
      buildGridDOM(gridEnemy);

      initModels();

      // Guest says hello first
      if (!isHost) {
        sendMsg(MSG.HELLO, { name: myName });
        startPlacement();
      }
      // Host waits for MSG.HELLO which triggers startPlacement
    });

    conn.on('data', onMessage);

    conn.on('close', () => {
      if (gameActive) showToast('Opponent disconnected.', 'error', 5000);
      setTurnIndicator(false, true);
    });

    conn.on('error', err => {
      showToast('Connection error.', 'error');
    });
  }

  // ── Model init ─────────────────────────────────────────────────
  function initModels() {
    myGrid  = new Grid();
    oppGrid = new Grid();
    myFleet  = new Fleet();
    oppFleet = null;
    placedTypes  = new Set();
    oppReady     = false;
    gameActive   = false;
    myShots = 0; myHits = 0; enemySunk = 0;
    placingShip  = null;
    placeDir     = DIRS.H;
    myRestartReady  = false;
    oppRestartReady = false;
    isMyTurn = false;
    updateStats({ myShots, myHits, enemySunk });
    logEl.innerHTML = '';
  }

  // ── Placement phase ────────────────────────────────────────────
  function startPlacement() {
    setTurnIndicator(false, true);
    const setupPanel = document.getElementById('setup-panel');
    setupPanel.classList.remove('hidden');
    document.getElementById('restart-panel').classList.add('hidden');

    // Wire roster
    document.querySelectorAll('#fleet-roster li').forEach(li => {
      li.classList.remove('placed', 'placing');
      li.onclick = () => selectShipToPlace(li.dataset.type, parseInt(li.dataset.size));
    });

    // Rotate button
    document.getElementById('btn-rotate').onclick = () => {
      placeDir = placeDir === DIRS.H ? DIRS.V : DIRS.H;
      showToast('Direction: ' + (placeDir === DIRS.H ? 'Horizontal →' : 'Vertical ↓'));
    };

    // Random button
    document.getElementById('btn-random').onclick = placeAllRandom;

    // Ready button
    document.getElementById('btn-ready').onclick = onReadyClicked;

    // Grid click / hover on human grid
    gridHuman.onclick = e => {
      const cell = e.target.closest('.cell');
      if (!cell || !placingShip) return;
      const x = parseInt(cell.dataset.x);
      const y = parseInt(cell.dataset.y);
      doPlaceShip(x, y);
    };
    gridHuman.onmouseover = e => {
      const cell = e.target.closest('.cell');
      if (!cell || !placingShip) return;
      clearPreview();
      const x = parseInt(cell.dataset.x);
      const y = parseInt(cell.dataset.y);
      showPreview(x, y, placingShip.size, placeDir);
    };
    gridHuman.onmouseleave = () => clearPreview();

    // Enemy grid should NOT be interactive during placement
    gridEnemy.onclick = null;
  }

  function selectShipToPlace(type, size) {
    if (placedTypes.has(type)) return;
    document.querySelectorAll('#fleet-roster li').forEach(li => {
      if (!placedTypes.has(li.dataset.type)) li.classList.remove('placing');
    });
    document.getElementById(type)?.classList.add('placing');
    // Use fleet-roster li
    document.querySelector(`#fleet-roster li[data-type="${type}"]`)?.classList.add('placing');
    placingShip = { type, size };
  }

  function showPreview(x, y, size, dir) {
    const cells = getShipCells(x, y, size, dir);
    const valid = cells.length === size && cells.every(c => myGrid.get(c.x, c.y) === 0);
    cells.forEach(c => {
      const el = getCell(gridHuman, c.x, c.y);
      if (el) el.classList.add(valid ? 'preview' : 'preview-invalid');
    });
  }

  function clearPreview() {
    gridHuman.querySelectorAll('.preview, .preview-invalid').forEach(el => {
      el.classList.remove('preview', 'preview-invalid');
    });
  }

  function getShipCells(x, y, size, dir) {
    const cells = [];
    for (let i = 0; i < size; i++) {
      const cx = dir === DIRS.H ? x + i : x;
      const cy = dir === DIRS.V ? y + i : y;
      if (cx < GRID_SIZE && cy < GRID_SIZE) cells.push({x: cx, y: cy});
    }
    return cells;
  }

  function doPlaceShip(x, y) {
    if (!placingShip) return;
    const ok = myFleet.placeShip(placingShip.type, x, y, placeDir, myGrid);
    if (!ok) {
      showToast('Invalid position!', 'error', 1500);
      return;
    }
    // Render ship cells
    const ship = myFleet.ships.find(s => s.type === placingShip.type);
    ship.cells.forEach(c => setCellState(gridHuman, c.x, c.y, 'ship'));

    const li = document.querySelector(`#fleet-roster li[data-type="${placingShip.type}"]`);
    if (li) { li.classList.remove('placing'); li.classList.add('placed'); }

    placedTypes.add(placingShip.type);
    placingShip = null;
    clearPreview();

    if (placedTypes.size === SHIPS.length) {
      document.getElementById('btn-ready').classList.remove('hidden');
    }
  }

  function placeAllRandom() {
    // Reset existing placements
    myGrid  = new Grid();
    myFleet = new Fleet();
    placedTypes = new Set();
    buildGridDOM(gridHuman);

    // Re-wire click on fresh grid
    gridHuman.onclick = e => {
      const cell = e.target.closest('.cell');
      if (!cell || !placingShip) return;
      doPlaceShip(parseInt(cell.dataset.x), parseInt(cell.dataset.y));
    };
    gridHuman.onmouseover = e => {
      const cell = e.target.closest('.cell');
      if (!cell || !placingShip) return;
      clearPreview();
      showPreview(parseInt(cell.dataset.x), parseInt(cell.dataset.y), placingShip.size, placeDir);
    };
    gridHuman.onmouseleave = () => clearPreview();

    SHIPS.forEach(s => {
      let placed = false;
      let attempts = 0;
      while (!placed && attempts < 200) {
        const x   = rnd(0, GRID_SIZE - 1);
        const y   = rnd(0, GRID_SIZE - 1);
        const dir = Math.random() < 0.5 ? DIRS.H : DIRS.V;
        placed = myFleet.placeShip(s.type, x, y, dir, myGrid);
        attempts++;
      }
    });

    // Render all ships
    myFleet.ships.forEach(ship => {
      ship.cells.forEach(c => setCellState(gridHuman, c.x, c.y, 'ship'));
    });

    // Mark all as placed
    document.querySelectorAll('#fleet-roster li').forEach(li => {
      li.classList.remove('placing');
      li.classList.add('placed');
      placedTypes.add(li.dataset.type);
    });

    placingShip = null;
    document.getElementById('btn-ready').classList.remove('hidden');
  }

  function onReadyClicked() {
    sendMsg(MSG.READY, { fleet: myFleet.serialize() });
    document.getElementById('btn-ready').disabled = true;
    document.getElementById('btn-ready').textContent = '✔ WAITING…';
    showToast('Fleet deployed! Waiting for opponent…', 'success');
    if (oppReady) checkBothReady();
  }

  // ── Game phase ─────────────────────────────────────────────────
  function startGame() {
    gameActive  = true;
    // Host goes first
    isMyTurn    = isHost;
    setTurnIndicator(isMyTurn, false);
    addLog('⚔ Battle begins!', 'log-win');

    // Wire enemy grid
    gridEnemy.onclick = e => {
      if (!isMyTurn || !gameActive) return;
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const x = parseInt(cell.dataset.x);
      const y = parseInt(cell.dataset.y);
      if (oppGrid.isAlreadyShot(x, y)) { showToast('Already fired here!', '', 1200); return; }
      fireAt(x, y);
    };

    // Make enemy cells show shootable cursor on hover
    updateEnemyShootable();
  }

  function updateEnemyShootable() {
    gridEnemy.querySelectorAll('.cell').forEach(cell => {
      const x = parseInt(cell.dataset.x);
      const y = parseInt(cell.dataset.y);
      if (isMyTurn && !oppGrid.isAlreadyShot(x, y)) {
        cell.classList.add('shootable');
      } else {
        cell.classList.remove('shootable');
      }
    });
  }

  function fireAt(x, y) {
    isMyTurn = false;
    setTurnIndicator(false, false);
    updateEnemyShootable();
    sendMsg(MSG.FIRE, { x, y });
    myShots++;
    updateStats({ myShots, myHits, enemySunk });
  }

  // Incoming shot from opponent — adjudicate locally
  function handleIncomingFire(x, y) {
    const result = myGrid.isShip(x, y) ? 'hit' : 'miss';
    let sunkShip = null;

    if (result === 'hit') {
      const res = myFleet.recordHit(x, y);
      myGrid.set(x, y, 3);
      setCellState(gridHuman, x, y, 'hit');

      if (res && res.sunk) {
        sunkShip = res.ship.type;
        res.ship.cells.forEach(c => myGrid.set(c.x, c.y, 4));
        markSunkOnGrid(gridHuman, res.ship.cells);
        sendMsg(MSG.SUNK, { ship: sunkShip }); // tell opponent their ship sank
      }

      if (myFleet.allSunk()) {
        sendMsg(MSG.FIRE_ACK, { x, y, result: 'hit', ship: sunkShip });
        sendMsg(MSG.GAME_WIN);
        handleGameOver(false);
        return;
      }
    } else {
      myGrid.set(x, y, 2);
      setCellState(gridHuman, x, y, 'miss');
    }

    sendMsg(MSG.FIRE_ACK, { x, y, result, ship: sunkShip });

    // Now it's my turn
    isMyTurn = true;
    setTurnIndicator(true, false);
    updateEnemyShootable();
    addLog(`Enemy fired [${String.fromCharCode(65 + x)}${y + 1}] → ${result.toUpperCase()}`, result === 'hit' ? 'log-hit' : 'log-miss');
  }

  function handleFireAck(x, y, result, ship) {
    oppGrid.set(x, y, result === 'hit' ? 3 : 2);
    setCellState(gridEnemy, x, y, result === 'hit' ? 'hit' : 'miss');

    if (result === 'hit') {
      myHits++;
      addLog(`You fired [${String.fromCharCode(65 + x)}${y + 1}] → HIT! 🎯`, 'log-hit');
    } else {
      addLog(`You fired [${String.fromCharCode(65 + x)}${y + 1}] → MISS`, 'log-miss');
    }
    updateStats({ myShots, myHits, enemySunk });
  }

  function handleEnemySunk(shipType) {
    // Mark all cells of that ship as sunk on enemy grid
    if (oppFleet) {
      const ship = oppFleet.ships.find(s => s.type === shipType);
      if (ship) {
        ship.sunk = true;
        ship.cells.forEach(c => { oppGrid.set(c.x, c.y, 4); setCellState(gridEnemy, c.x, c.y, 'sunk'); });
      }
    }
    const name = SHIPS.find(s => s.type === shipType)?.name || shipType;
    enemySunk++;
    updateStats({ myShots, myHits, enemySunk });
    addLog(`⚓ Enemy's ${name} SUNK!`, 'log-sunk');
    showToast(`You sank their ${name}!`, 'success');

    if (enemySunk >= 5) handleGameOver(true);
  }

  function handleGameOver(won) {
    gameActive = false;
    setTurnIndicator(false, true);
    gridEnemy.onclick = null;
    updateEnemyShootable();

    const title = document.getElementById('result-title');
    const msg   = document.getElementById('result-msg');
    title.textContent = won ? '🏆 VICTORY!' : '💀 DEFEAT';
    title.style.color = won ? 'var(--green)' : 'var(--red)';
    msg.textContent   = won
      ? `You sank all of ${oppName}'s ships! Accuracy: ${myShots > 0 ? Math.round(100 * myHits / myShots) : 0}%`
      : `${oppName} sank your entire fleet.`;

    addLog(won ? '🏆 YOU WIN!' : '💀 YOU LOST', 'log-win');

    document.getElementById('setup-panel').classList.add('hidden');
    document.getElementById('restart-panel').classList.remove('hidden');

    document.getElementById('btn-restart').onclick = () => {
      myRestartReady = true;
      sendMsg(MSG.RESTART);
      document.getElementById('btn-restart').disabled = true;
      document.getElementById('btn-restart').textContent = '⏳ Waiting…';
      if (oppRestartReady) doRestart();
    };
    document.getElementById('btn-lobby').onclick = () => {
      peer?.destroy();
      location.reload();
    };
  }

  function doRestart() {
    initModels();
    buildGridDOM(gridHuman);
    buildGridDOM(gridEnemy);

    // Re-wire human grid hover for placement
    gridHuman.onmouseover = e => {
      const cell = e.target.closest('.cell');
      if (!cell || !placingShip) return;
      clearPreview();
      showPreview(parseInt(cell.dataset.x), parseInt(cell.dataset.y), placingShip.size, placeDir);
    };
    gridHuman.onmouseleave = () => clearPreview();

    gridEnemy.onclick = null;

    document.getElementById('restart-panel').classList.add('hidden');
    document.getElementById('setup-panel').classList.remove('hidden');
    document.getElementById('btn-ready').classList.add('hidden');
    document.getElementById('btn-ready').disabled = false;
    document.getElementById('btn-ready').textContent = '✔ READY';

    document.querySelectorAll('#fleet-roster li').forEach(li => {
      li.classList.remove('placed', 'placing');
      li.onclick = () => selectShipToPlace(li.dataset.type, parseInt(li.dataset.size));
    });

    setTurnIndicator(false, true);
    addLog('— New game started —', 'log-win');
  }

  // ── Lobby wiring ───────────────────────────────────────────────
  function initLobby() {
    document.getElementById('btn-host').onclick = () => {
      const name = document.getElementById('host-name').value.trim() || 'Admiral';
      hostGame(name);
      document.getElementById('btn-host').disabled = true;
    };

    document.getElementById('btn-join').onclick = () => {
      const name = document.getElementById('join-name').value.trim() || 'Commander';
      const code = document.getElementById('join-code').value.trim();
      if (!code) { showToast('Enter a room code!', 'error'); return; }
      document.getElementById('btn-join').disabled = true;
      joinGame(name, code);
    };

    document.getElementById('btn-copy-code').onclick = () => {
      const code = document.getElementById('room-code-value').textContent;
      navigator.clipboard.writeText(code).then(
        () => showToast('Code copied!', 'success', 1800),
        () => showToast('Copy failed — select manually', 'error'),
      );
    };

    // Allow Enter key in join fields
    document.getElementById('join-code').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-join').click();
    });
    document.getElementById('join-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('join-code').focus();
    });
    document.getElementById('host-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-host').click();
    });
  }

  // ── Bootstrap ──────────────────────────────────────────────────
  function init() {
    initLobby();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
