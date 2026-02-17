const path = require('path');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Basic config ---
const MAX_HISTORY = 100;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// --- Database setup (SQLite) ---
const dbPath = path.join(__dirname, 'chat.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    owner_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS room_members (
    user_id INTEGER NOT NULL,
    room_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, room_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );
`);

// Ensure messages table has room_id and there is a default "General" room
function ensureRoomSchema() {
  const columns = db.prepare('PRAGMA table_info(messages)').all();
  const hasRoomId = columns.some((col) => col.name === 'room_id');
  if (!hasRoomId) {
    db.exec('ALTER TABLE messages ADD COLUMN room_id INTEGER');
    db.exec('UPDATE messages SET room_id = 1 WHERE room_id IS NULL');
  }

  db.exec(`
    INSERT INTO rooms (id, name, owner_id)
    SELECT 1, 'General', NULL
    WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE id = 1);
  `);
}

ensureRoomSchema();

// --- Express middleware ---
app.use(express.json());

// Serve static client files
app.use(express.static(path.join(__dirname, 'public')));

// Dedicated route for profile page (so /profile serves profile.html)
app.get(['/profile', '/profile/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// Track connected clients and usernames
// ws -> { userId, username, roomId }
const clients = new Map();

// --- Auth helpers ---
function createToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function getUserFromToken(token) {
  try {
    if (!token) return null;
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || !payload.userId || !payload.username) return null;
    return { id: payload.userId, username: payload.username };
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const [scheme, rawToken] = auth.split(' ');
  if (scheme !== 'Bearer' || !rawToken) {
    return res
      .status(401)
      .json({ error: 'Missing or invalid Authorization header.' });
  }
  const user = getUserFromToken(rawToken);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
  req.user = user;
  return next();
}

// --- REST API: auth ---
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const cleanUsername = String(username || '').trim().slice(0, 20);
    const cleanPassword = String(password || '');

    if (!cleanUsername || cleanUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }
    if (!cleanPassword || cleanPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 10);
    const insertUser = db.prepare(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)' //
    );

    let userId;
    try {
      const result = insertUser.run(cleanUsername, passwordHash);
      userId = result.lastInsertRowid;
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Username is already taken.' });
      }
      console.error('Error inserting user:', err);
      return res.status(500).json({ error: 'Failed to create user.' });
    }

    const user = { id: userId, username: cleanUsername };
    const token = createToken(user);
    return res.json({ token, username: user.username });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const cleanUsername = String(username || '').trim().slice(0, 50);
    const cleanPassword = String(password || '');

    if (!cleanUsername || !cleanPassword) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const getUser = db.prepare(
      'SELECT id, username, password_hash FROM users WHERE username = ?'
    );
    const row = getUser.get(cleanUsername);
    if (!row) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const ok = await bcrypt.compare(cleanPassword, row.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const user = { id: row.id, username: row.username };
    const token = createToken(user);
    return res.json({ token, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

app.get('/api/me', requireAuth, (req, res) => {
  try {
    const row = db
      .prepare('SELECT id, username, created_at FROM users WHERE id = ?')
      .get(req.user.id);
    if (!row) {
      return res.status(404).json({ error: 'User not found.' });
    }
    return res.json({
      id: row.id,
      username: row.username,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ error: 'Failed to load profile.' });
  }
});
app.get('/api/rooms', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;

    // Ensure the default General room exists and the user is a member
    db.exec(`
      INSERT INTO rooms (id, name, owner_id)
      SELECT 1, 'General', NULL
      WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE id = 1);
    `);

    const addMember = db.prepare(
      'INSERT OR IGNORE INTO room_members (user_id, room_id, role) VALUES (?, 1, ?)' //
    );
    addMember.run(userId, 'member');

    const rows = db
      .prepare(
        'SELECT r.id, r.name, r.owner_id FROM rooms r JOIN room_members m ON m.room_id = r.id WHERE m.user_id = ? ORDER BY r.name'
      )
      .all(userId);

    const rooms = rows.map((row) => ({
      id: row.id,
      name: row.name,
      isOwner: row.owner_id === userId,
    }));

    return res.json({ rooms });
  } catch (err) {
    console.error('Get rooms error:', err);
    return res.status(500).json({ error: 'Failed to load rooms.' });
  }
});

app.post('/api/rooms', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const { name } = req.body || {};
    const cleanName = String(name || '')
      .trim()
      .slice(0, 50);

    if (!cleanName || cleanName.length < 3) {
      return res
        .status(400)
        .json({ error: 'Room name must be at least 3 characters.' });
    }

    const insertRoom = db.prepare(
      'INSERT INTO rooms (name, owner_id) VALUES (?, ?)' //
    );
    let roomId;
    try {
      const result = insertRoom.run(cleanName, userId);
      roomId = result.lastInsertRowid;
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Room name is already taken.' });
      }
      console.error('Create room error:', err);
      return res.status(500).json({ error: 'Failed to create room.' });
    }

    const insertMember = db.prepare(
      'INSERT OR IGNORE INTO room_members (user_id, room_id, role) VALUES (?, ?, ?)' //
    );
    insertMember.run(userId, roomId, 'owner');

    return res.json({ room: { id: roomId, name: cleanName, isOwner: true } });
  } catch (err) {
    console.error('Create room error:', err);
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

app.get('/api/rooms/:roomId/members', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const roomId = Number(req.params.roomId) || 0;
    if (!roomId) {
      return res.status(400).json({ error: 'Invalid room id.' });
    }

    const room = db
      .prepare(
        'SELECT r.id, r.name, r.owner_id FROM rooms r JOIN room_members m ON m.room_id = r.id WHERE r.id = ? AND m.user_id = ?'
      )
      .get(roomId, userId);

    if (!room) 
      return res.status(404).json({ error: 'Room not found or access denied.' });

    const rows = db
      .prepare(
        'SELECT u.id, u.username, m.role, m.created_at FROM room_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ? ORDER BY u.username'
      )
      .all(roomId);

    const members = rows.map((row) => ({
      id: row.id,
      username: row.username,
      role: row.role,
      joinedAt: row.created_at,
    }));

    return res.json({
      room: {
        id: room.id,
        name: room.name,
        isOwner: room.owner_id === userId,
      },
      members,
    });
  } catch (err) {
    console.error('Get room members error:', err);
    return res.status(500).json({ error: 'Failed to load room members.' });
  }
});

app.post('/api/rooms/:roomId/invite', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const roomId = Number(req.params.roomId) || 0;
    if (!roomId) {
      return res.status(400).json({ error: 'Invalid room id.' });
    }

    const room = db
      .prepare('SELECT id, owner_id FROM rooms WHERE id = ?')
      .get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }
    if (room.owner_id !== userId) {
      return res.status(403).json({ error: 'Only the room owner can invite.' });
    }

    const { username } = req.body || {};
    const cleanUsername = String(username || '').trim().slice(0, 50);
    if (!cleanUsername) {
      return res.status(400).json({ error: 'Username is required.' });
    }

    const target = db
      .prepare('SELECT id, username FROM users WHERE username = ?')
      .get(cleanUsername);
    if (!target) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const addMember = db.prepare(
      'INSERT OR IGNORE INTO room_members (user_id, room_id, role) VALUES (?, ?, ?)' //
    );
    addMember.run(target.id, roomId, 'member');

    return res.json({ success: true });
  } catch (err) {
    console.error('Invite error:', err);
    return res.status(500).json({ error: 'Failed to invite user.' });
  }
});

function getUserList(roomId) {
  const names = [];
  const seen = new Set();
  for (const info of clients.values()) {
    if (info.roomId === roomId && !seen.has(info.username)) {
      seen.add(info.username);
      names.push(info.username);
    }
  }
  return names;
}

function broadcast(data, roomId, exceptWs = null) {
  const msg = JSON.stringify(data);
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN || ws === exceptWs) continue;
    const info = clients.get(ws);
    if (!info || info.roomId !== roomId) continue;
    ws.send(msg);
  }
}

function sendRecentHistory(ws, roomId) {
  try {
    const rows = db
      .prepare(
        'SELECT username, text FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT ?'
      )
      .all(roomId, MAX_HISTORY);
    const messages = rows
      .slice()
      .reverse()
      .map((row) => ({ type: 'chat', username: row.username, text: row.text }));
    if (messages.length > 0) {
      ws.send(JSON.stringify({ type: 'history', messages }));
    }
  } catch (err) {
    console.error('Failed to load history from DB:', err);
  }
}

// --- WebSocket handling ---
wss.on('connection', (ws, req) => {
  let roomId = 1;
  try {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const roomIdParam = url.searchParams.get('roomId');
    const user = getUserFromToken(token);
    if (!user) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    roomId = Number(roomIdParam) || 1;

    if (roomId !== 1) {
      const membership = db
        .prepare(
          'SELECT r.id, r.name FROM rooms r JOIN room_members m ON m.room_id = r.id WHERE r.id = ? AND m.user_id = ?'
        )
        .get(roomId, user.id);
      if (!membership) {
        ws.close(4003, 'Forbidden');
        return;
      }
    }

    // Ensure only one active WebSocket per user (single login)
    for (const [otherWs, info] of clients.entries()) {
      if (info.userId === user.id) {
        try {
          otherWs.close(4002, 'Another session opened');
        } catch {
          // ignore
        }
      }
    }

    clients.set(ws, { userId: user.id, username: user.username, roomId });

    // Send recent chat history first
    sendRecentHistory(ws, roomId);

    // Confirm join and notify others
    ws.send(
      JSON.stringify({ type: 'system', text: `You joined as ${user.username}` })
    );
    broadcast(
      { type: 'system', text: `${user.username} joined the chat` },
      roomId,
      ws
    );
    broadcast({ type: 'users', users: getUserList(roomId) }, roomId);
  } catch (err) {
    console.error('Error during WebSocket connection:', err);
    ws.close(1011, 'Unexpected error');
    return;
  }

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      return;
    }
    const info = clients.get(ws);
    if (!info) {
      return;
    }

    if (data.type === 'typing') {
      const isTyping = Boolean(data.isTyping);
      broadcast({ type: 'typing', username: info.username, isTyping }, info.roomId, ws);
      return;
    }

    if (data.type === 'chat') {
      const text = String(data.text || '').slice(0, 500);
      if (!text.trim()) return;
      const chatMessage = { type: 'chat', username: info.username, text };
      broadcast(chatMessage, info.roomId);

      try {
        const insertMessage = db.prepare(
          'INSERT INTO messages (user_id, username, text, room_id) VALUES (?, ?, ?, ?)' //
        );
        insertMessage.run(info.userId, info.username, text, info.roomId);
      } catch (err) {
        console.error('Failed to insert chat message:', err);
      }
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (info) {
      broadcast(
        { type: 'system', text: `${info.username} left the chat` },
        info.roomId,
        ws
      );
      clients.delete(ws);
      broadcast({ type: 'users', users: getUserList(info.roomId) }, info.roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chat server listening on http://localhost:${PORT}`);
});
