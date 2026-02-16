# Simple Chat (Node.js + WebSocket)

This is a minimal real-time chat app you can run locally to talk with friends on the same network or over the internet (with port forwarding).

## How it works

- A Node.js server (server.js) serves the static client files in public/ and accepts WebSocket connections.
- When a browser page connects, it sends a `join` message with a username.
- Chat messages are sent as JSON over the WebSocket and broadcast to all connected clients.

## Prerequisites

- Node.js (LTS version recommended) installed on your machine.

## Install and run

```bash
npm install
npm start
```

Then open your browser at:

- http://localhost:3000

Open that page in multiple browser windows or devices on the same network to chat between them.

## Next steps / ideas

- Add rooms (channels) instead of one global room.
- Show list of online users.
- Persist message history in a database.
- Add authentication / login.
- Explore true peer-to-peer using WebRTC with a small signaling server.
