const path = require('path');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static client files
app.use(express.static(path.join(__dirname, 'public')));

// Track connected clients and usernames
const clients = new Map(); // ws -> { username }

function getUserList() {
  return Array.from(clients.values()).map((client) => client.username);
}

function broadcast(data, exceptWs = null) {
  const msg = JSON.stringify(data);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN && ws !== exceptWs) {
      ws.send(msg);
    }
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      return;
    }

    if (data.type === 'join') {
      const username = String(data.username || 'Anonymous').slice(0, 20);
      clients.set(ws, { username });
      ws.send(JSON.stringify({ type: 'system', text: `You joined as ${username}` }));
      broadcast({ type: 'system', text: `${username} joined the chat` }, ws);
      broadcast({ type: 'users', users: getUserList() });
      return;
    }

    if (data.type === 'typing') {
      const info = clients.get(ws);
      if (!info) return;
      const isTyping = Boolean(data.isTyping);
      broadcast({ type: 'typing', username: info.username, isTyping }, ws);
      return;
    }

    if (data.type === 'chat') {
      const info = clients.get(ws);
      if (!info) return;
      const text = String(data.text || '').slice(0, 500);
      if (!text.trim()) return;
      broadcast({ type: 'chat', username: info.username, text });
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (info) {
      broadcast({ type: 'system', text: `${info.username} left the chat` }, ws);
      clients.delete(ws);
      broadcast({ type: 'users', users: getUserList() });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chat server listening on http://localhost:${PORT}`);
});
