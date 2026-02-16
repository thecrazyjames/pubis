(function () {
  const messagesEl = document.getElementById('messages');
  const statusEl = document.getElementById('status');
  const formEl = document.getElementById('form');
  const inputEl = document.getElementById('input');
  const userListEl = document.getElementById('user-list');
  const typingEl = document.getElementById('typing');

  let ws;
  let username;
  let typing = false;
  let typingTimeout = null;
  const typingUsers = new Set();

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

  function connect() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = proto + '://' + window.location.host;
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      statusEl.textContent = 'Connected';
      if (!username) {
        username = prompt('Choose a username:') || 'Guest';
      }
      ws.send(
        JSON.stringify({
          type: 'join',
          username,
        })
      );
    });

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data || !data.type) return;
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

    ws.addEventListener('close', () => {
      statusEl.textContent = 'Disconnected. Reconnecting in 3s…';
      setTimeout(connect, 3000);
    });

    ws.addEventListener('error', () => {
      statusEl.textContent = 'Error';
    });
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

  connect();
})();
