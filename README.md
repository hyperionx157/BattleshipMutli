# ⚓ Battleship — P2P Multiplayer

Real-time two-player Battleship using WebRTC peer-to-peer networking via [PeerJS](https://peerjs.com/).  
**No server required.** Works on GitHub Pages or any static host.

---

## 🚀 Hosting on GitHub Pages

1. **Fork / upload** this folder to a GitHub repository.
2. Go to **Settings → Pages**.
3. Set **Source** to `main` branch, folder `/` (root).
4. Click **Save**. Your game is live at `https://<username>.github.io/<repo>/`.

That's it — share the URL with friends!

---

## 🎮 How to Play

1. **Host** opens the game, enters a callsign, clicks **DEPLOY FLEET**.  
   A 6-character room code appears — share it with your opponent.
2. **Guest** opens the same URL, enters a callsign, pastes the code, clicks **BOARD VESSEL**.
3. Both players **place their 5 ships** on their grid (click to place, Rotate button to rotate, or Random for auto-placement).
4. Click **✔ READY** when done.
5. Once both are ready, the game starts — **Host goes first**.
6. Click cells on the **Enemy Waters** grid to fire. Watch the Battle Log!

### Ships
| Ship           | Size |
|----------------|------|
| Aircraft Carrier | 5  |
| Battleship     | 4    |
| Destroyer      | 3    |
| Submarine      | 3    |
| Patrol Boat    | 2    |

---

## 🌐 How Networking Works

- Uses **PeerJS** (WebRTC DataChannel) — pure peer-to-peer in the browser.
- PeerJS's default public STUN/signaling servers are used for the initial handshake.
- After connection is established, all game data flows **directly** between browsers.
- **No game data is sent to any server.**

### Firewall / corporate networks
WebRTC requires STUN (and sometimes TURN) servers to traverse NATs. PeerJS's free
public servers handle most cases. If players are behind strict firewalls, the
connection may fail — try a mobile hotspot.

---

## 📁 File Structure

```
battleship-multiplayer/
├── index.html
├── css/
│   └── styles.css
├── js/
│   └── game.js
└── img/
    ├── favicon.png
    └── cross-icon.svg
```

---

## ✏️ Customization

- **Grid size**: Change `GRID_SIZE` in `game.js` (default 10).
- **Ships**: Edit the `SHIPS` array in `game.js`.
- **Colors**: All colors are CSS variables in `:root` in `styles.css`.
- **PeerJS server**: Pass your own `{ host, port, path }` config to `new Peer(...)` for a self-hosted signaling server.

---

## 📜 License

MIT — based on the original single-player Battleship by [Bill Mei](https://github.com/Battleship).
