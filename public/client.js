(function () {
  const messagesEl = document.getElementById('messages');
  const statusEl = document.getElementById('status');
  const formEl = document.getElementById('form');
  const inputEl = document.getElementById('input');
  const userListEl = document.getElementById('user-list');
  const typingEl = document.getElementById('typing');
  const authSectionEl = document.getElementById('auth-section');
  const chatSectionEl = document.getElementById('chat-section');
  const authUsernameEl = document.getElementById('auth-username');
  const authPasswordEl = document.getElementById('auth-password');
  const authErrorEl = document.getElementById('auth-error');
  const loginBtnEl = document.getElementById('btn-login');
  const signupBtnEl = document.getElementById('btn-signup');
  const roomSelectEl = document.getElementById('room-select');
  const newRoomBtnEl = document.getElementById('btn-new-room');
  const headerUsernameEl = document.getElementById('header-username');
  const headerRoomEl = document.getElementById('header-room');
  const profileOverlayEl = document.getElementById('profile-overlay');
  const profileCloseEl = document.getElementById('profile-close');
  const profileUsernameEl = document.getElementById('profile-username');
  const profileUserIdEl = document.getElementById('profile-user-id');
  const profileCreatedEl = document.getElementById('profile-created');
  const profileRoomsListEl = document.getElementById('profile-rooms-list');
  const profileErrorEl = document.getElementById('profile-error');
  const profileBtnEl = document.getElementById('btn-profile');
  const profileNewRoomBtnEl = document.getElementById('profile-new-room');
  const profileLogoutBtnEl = document.getElementById('profile-logout');
  const roomMembersBtnEl = document.getElementById('btn-room-members');
  const roomAdminOverlayEl = document.getElementById('room-admin-overlay');
  const roomAdminCloseEl = document.getElementById('room-admin-close');
  const roomAdminRoomNameEl = document.getElementById('room-admin-room-name');
  const roomAdminMembersListEl = document.getElementById('room-admin-members-list');
  const roomAdminInviteBlockEl = document.getElementById('room-admin-invite-block');
  const roomAdminInviteInputEl = document.getElementById('room-admin-invite-username');
  const roomAdminInviteBtnEl = document.getElementById('room-admin-invite-btn');
  const roomAdminErrorEl = document.getElementById('room-admin-error');

  let ws;
  let username = null;
  let token = null;
  let currentRoomId = 1;
  let typing = false;
  let typingTimeout = null;
  const typingUsers = new Set();
  let roomsCache = [];

  function addMessage({ type, username, text }) {
    const div = document.createElement('div');
    div.classList.add('message');
    if (type === 'system') {
      div.classList.add('system');
      div.textContent = text;
    } else if (type === 'chat') {
      div.classList.add('chat');
      const nameSpan = document.createElement('span');
      nameSpan.classList.add('username');
      nameSpan.textContent = username + ':';
      const textSpan = document.createElement('span');
      textSpan.textContent = ' ' + text;
      div.appendChild(nameSpan);
      div.appendChild(textSpan);
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setAuthError(message) {
    authErrorEl.textContent = message || '';
  }

  function setHeaderUsername(name) {
    if (!headerUsernameEl) return;
    const clean = (name || '').trim();
    const initial = clean ? clean.charAt(0).toUpperCase() : '?';
    headerUsernameEl.textContent = initial;
    if (profileBtnEl) {
      profileBtnEl.title = clean ? `Profile: ${clean}` : 'Profile';
    }
  }

  function showChatUI() {
    authSectionEl.classList.add('hidden');
    chatSectionEl.classList.remove('hidden');
    formEl.classList.remove('hidden');
    if (headerRoomEl) {
      headerRoomEl.classList.remove('hidden');
    }
  }

  function showAuthUI() {
    authSectionEl.classList.remove('hidden');
    chatSectionEl.classList.add('hidden');
    formEl.classList.add('hidden');
    statusEl.textContent = 'Not connected';
    messagesEl.innerHTML = '';
    userListEl.textContent = 'No one online';
    typingEl.textContent = '';
    if (roomSelectEl) {
      roomSelectEl.innerHTML = '';
    }
    if (headerRoomEl) {
      headerRoomEl.classList.add('hidden');
    }
  }

  function showProfileOverlay() {
    if (!profileOverlayEl) return;
    profileOverlayEl.classList.remove('hidden');
  }

  function hideProfileOverlay() {
    if (!profileOverlayEl) return;
    profileOverlayEl.classList.add('hidden');
  }

  function showRoomAdminOverlay() {
    if (!roomAdminOverlayEl) return;
    roomAdminOverlayEl.classList.remove('hidden');
  }

  function hideRoomAdminOverlay() {
    if (!roomAdminOverlayEl) return;
    roomAdminOverlayEl.classList.add('hidden');
  }

  function updateUserList(users) {
    if (!Array.isArray(users) || users.length === 0) {
      userListEl.textContent = 'No one online';
      return;
    }
    userListEl.textContent = 'Online: ' + users.join(', ');
  }

  function updateTypingIndicator() {
    if (typingUsers.size === 0) {
      typingEl.textContent = '';
      return;
    }

    const names = Array.from(typingUsers);
    let text;
    if (names.length === 1) {
      text = names[0] + ' is typing…';
    } else if (names.length === 2) {
      text = names[0] + ' and ' + names[1] + ' are typing…';
    } else {
      text = names[0] + ', ' + names[1] + ' and others are typing…';
    }
    typingEl.textContent = text;
  }

  function sendTyping(isTyping) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: 'typing',
        isTyping,
      })
    );
  }

  function logout() {
    token = null;
    username = null;
    window.localStorage.removeItem('chat_token');
    window.localStorage.removeItem('chat_username');
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    setHeaderUsername('');
    hideProfileOverlay();
    showAuthUI();
  }

  function connect() {
    if (!token) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const params = new URLSearchParams();
    params.set('token', token);
    if (currentRoomId) {
      params.set('roomId', String(currentRoomId));
    }
    const qs = '?' + params.toString();
    const url = proto + '://' + window.location.host + qs;
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      statusEl.textContent = 'Connected';
      // Clear messages on a fresh connection so server-sent history is canonical
      messagesEl.innerHTML = '';
      showChatUI();
    });

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data || !data.type) return;
        if (data.type === 'history') {
          if (Array.isArray(data.messages)) {
            data.messages.forEach((msg) => {
              if (msg && msg.type) {
                addMessage(msg);
              }
            });
          }
          return;
        }
        if (data.type === 'users') {
          updateUserList(data.users || []);
          return;
        }
        if (data.type === 'typing') {
          if (!data.username) return;
          if (data.isTyping) {
            typingUsers.add(data.username);
          } else {
            typingUsers.delete(data.username);
          }
          updateTypingIndicator();
          return;
        }
        addMessage(data);
      } catch {
        // ignore bad messages
      }
    });

    ws.addEventListener('close', (event) => {
      // If the server closed us due to auth issues or another login,
      // log out and do not try to reconnect.
      if (event.code === 4001 || event.code === 4002) {
        logout();
        return;
      }
      statusEl.textContent = 'Disconnected. Reconnecting in 3s…';
      setTimeout(() => {
        if (token) {
          connect();
        }
      }, 3000);
    });

    ws.addEventListener('error', () => {
      statusEl.textContent = 'Error';
    });
  }

  async function authRequest(path, body) {
    setAuthError('');
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Request failed');
      }
      return data;
    } catch (err) {
      setAuthError(err.message || 'Request failed');
      throw err;
    }
  }

  async function apiRequest(path, options) {
    const opts = options || {};
    const headers = Object.assign({}, opts.headers || {}, {
      'Content-Type': 'application/json',
    });
    if (token) {
      headers.Authorization = 'Bearer ' + token;
    }
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || 'Request failed';
      throw new Error(msg);
    }
    return data;
  }

  function switchToRoom(nextId) {
    const roomId = Number(nextId) || 1;
    if (roomId === currentRoomId) return;
    currentRoomId = roomId;
    if (roomSelectEl) {
      roomSelectEl.value = String(currentRoomId);
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    } else {
      connect();
    }
  }

  async function loadRoomsAndMaybeConnect() {
    try {
      const data = await apiRequest('/api/rooms');
      const rooms = Array.isArray(data.rooms) ? data.rooms : [];
      roomsCache = rooms;
      roomSelectEl.innerHTML = '';
      rooms.forEach((room) => {
        const opt = document.createElement('option');
        opt.value = String(room.id);
        opt.textContent = room.name;
        roomSelectEl.appendChild(opt);
      });
      if (rooms.length > 0) {
        const existing = rooms.find((r) => r.id === currentRoomId);
        if (!existing) {
          currentRoomId = rooms[0].id;
        }
      }
      if (rooms.length > 0) {
        roomSelectEl.value = String(currentRoomId);
      }
      connect();
    } catch (err) {
      setAuthError(err.message || 'Failed to load rooms.');
    }
  }

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: 'chat',
        text,
      })
    );
    inputEl.value = '';
    if (typing) {
      typing = false;
      sendTyping(false);
    }
    if (typingTimeout) {
      clearTimeout(typingTimeout);
      typingTimeout = null;
    }
  });

  inputEl.addEventListener('input', () => {
    const hasText = inputEl.value.trim().length > 0;
    if (hasText && !typing) {
      typing = true;
      sendTyping(true);
    } else if (!hasText && typing) {
      typing = false;
      sendTyping(false);
    }

    if (hasText) {
      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }
      typingTimeout = setTimeout(() => {
        if (typing) {
          typing = false;
          sendTyping(false);
        }
      }, 2000);
    }
  });

  async function handleCreateRoom() {
    const name = window.prompt('Room name (min 3 chars):');
    if (!name) return;
    try {
      const data = await apiRequest('/api/rooms', {
        method: 'POST',
        body: { name },
      });
      const room = data.room;
      if (!room) return;
      roomsCache.push(room);
      const opt = document.createElement('option');
      opt.value = String(room.id);
      opt.textContent = room.name;
      roomSelectEl.appendChild(opt);
      switchToRoom(room.id);
      hideProfileOverlay();
    } catch (err) {
      setAuthError(err.message || 'Failed to create room.');
    }
  }
  loginBtnEl.addEventListener('click', async () => {
    const u = authUsernameEl.value.trim();
    const p = authPasswordEl.value;
    if (!u || !p) {
      setAuthError('Enter username and password.');
      return;
    }
    try {
      const data = await authRequest('/api/login', { username: u, password: p });
      token = data.token;
      username = data.username;
      window.localStorage.setItem('chat_token', token);
      window.localStorage.setItem('chat_username', username);
      setHeaderUsername(username);
      await loadRoomsAndMaybeConnect();
    } catch {
      // error already shown
    }
  });

  signupBtnEl.addEventListener('click', async () => {
    const u = authUsernameEl.value.trim();
    const p = authPasswordEl.value;
    if (!u || !p) {
      setAuthError('Enter username and password.');
      return;
    }
    try {
      const data = await authRequest('/api/signup', { username: u, password: p });
      token = data.token;
      username = data.username;
      window.localStorage.setItem('chat_token', token);
      window.localStorage.setItem('chat_username', username);
      setHeaderUsername(username);
      await loadRoomsAndMaybeConnect();
    } catch {
      // error already shown
    }
  });

  // Auto-login if we have a stored token
  (function initFromStorage() {
    const storedToken = window.localStorage.getItem('chat_token');
    const storedUsername = window.localStorage.getItem('chat_username');
    if (storedToken && storedUsername) {
      token = storedToken;
      username = storedUsername;
      setHeaderUsername(username);
      loadRoomsAndMaybeConnect();
    } else {
      showAuthUI();
    }
  })();

  roomSelectEl.addEventListener('change', () => {
    const value = roomSelectEl.value;
    switchToRoom(value);
  });

  newRoomBtnEl.addEventListener('click', async () => {
    handleCreateRoom();
  });

  if (profileNewRoomBtnEl) {
    profileNewRoomBtnEl.addEventListener('click', () => {
      if (!token) return;
      handleCreateRoom();
    });
  }

  async function openRoomAdmin() {
    if (!token || !currentRoomId) return;
    roomAdminErrorEl.textContent = '';
    try {
      const data = await apiRequest('/api/rooms/' + currentRoomId + '/members');
      const room = data.room || {};
      const members = Array.isArray(data.members) ? data.members : [];

      roomAdminRoomNameEl.textContent = room.name || '';
      roomAdminMembersListEl.innerHTML = '';
      if (members.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No members yet';
        roomAdminMembersListEl.appendChild(li);
      } else {
        members.forEach((member) => {
          const li = document.createElement('li');
          const roleLabel = member.role === 'owner' ? ' (owner)' : '';
          li.textContent = member.username + roleLabel;
          roomAdminMembersListEl.appendChild(li);
        });
      }

      if (roomAdminInviteBlockEl) {
        if (room.isOwner) {
          roomAdminInviteBlockEl.style.display = 'flex';
        } else {
          roomAdminInviteBlockEl.style.display = 'none';
        }
      }

      showRoomAdminOverlay();
    } catch (err) {
      roomAdminErrorEl.textContent = err.message || 'Failed to load room members.';
      showRoomAdminOverlay();
    }
  }

  async function openProfile() {
    if (!token) return;
    profileErrorEl.textContent = '';
    try {
      const [me, roomsData] = await Promise.all([
        apiRequest('/api/me'),
        apiRequest('/api/rooms'),
      ]);
      profileUsernameEl.textContent = me.username || '';
      profileUserIdEl.textContent = me.id != null ? String(me.id) : '';
      profileCreatedEl.textContent = me.createdAt || '';

      profileRoomsListEl.innerHTML = '';
      const rooms = Array.isArray(roomsData.rooms) ? roomsData.rooms : [];
      if (rooms.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No rooms yet';
        profileRoomsListEl.appendChild(li);
      } else {
        rooms.forEach((room) => {
          const li = document.createElement('li');
          li.textContent = room.name + (room.isOwner ? ' (owner)' : '');
          li.dataset.roomId = String(room.id);
          li.addEventListener('click', () => {
            switchToRoom(room.id);
            hideProfileOverlay();
          });
          profileRoomsListEl.appendChild(li);
        });
      }

      showProfileOverlay();
    } catch (err) {
      profileErrorEl.textContent = err.message || 'Failed to load profile.';
      showProfileOverlay();
    }
  }

  profileBtnEl.addEventListener('click', () => {
    if (!token) return;
    openProfile();
  });

  profileCloseEl.addEventListener('click', () => {
    hideProfileOverlay();
  });

  profileOverlayEl.addEventListener('click', (event) => {
    if (event.target === profileOverlayEl) {
      hideProfileOverlay();
    }
  });

  if (profileLogoutBtnEl) {
    profileLogoutBtnEl.addEventListener('click', () => {
      logout();
    });
  }

  if (roomMembersBtnEl) {
    roomMembersBtnEl.addEventListener('click', () => {
      if (!token) return;
      openRoomAdmin();
    });
  }

  if (roomAdminCloseEl) {
    roomAdminCloseEl.addEventListener('click', () => {
      hideRoomAdminOverlay();
    });
  }

  if (roomAdminOverlayEl) {
    roomAdminOverlayEl.addEventListener('click', (event) => {
      if (event.target === roomAdminOverlayEl) {
        hideRoomAdminOverlay();
      }
    });
  }

  if (roomAdminInviteBtnEl) {
    roomAdminInviteBtnEl.addEventListener('click', async () => {
      const target = roomAdminInviteInputEl.value.trim();
      if (!target) return;
      try {
        await apiRequest('/api/rooms/' + currentRoomId + '/invite', {
          method: 'POST',
          body: { username: target },
        });
        roomAdminInviteInputEl.value = '';
      } catch (err) {
        roomAdminErrorEl.textContent = err.message || 'Failed to invite user.';
      }
    });
  }
})();
