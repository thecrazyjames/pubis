(function () {
  const usernameEl = document.getElementById('profile-username');
  const userIdEl = document.getElementById('profile-user-id');
  const createdEl = document.getElementById('profile-created');
  const roomsListEl = document.getElementById('profile-rooms-list');
  const errorEl = document.getElementById('error');

  function setError(message) {
    errorEl.textContent = message || '';
  }

  function getToken() {
    return window.localStorage.getItem('chat_token');
  }

  async function apiRequest(path) {
    const token = getToken();
    if (!token) {
      throw new Error('Not logged in');
    }
    const res = await fetch(path, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }

  async function loadProfile() {
    try {
      const token = getToken();
      if (!token) {
        window.location.href = '/';
        return;
      }

      const [me, roomsData] = await Promise.all([
        apiRequest('/api/me'),
        apiRequest('/api/rooms'),
      ]);

      usernameEl.textContent = me.username || '';
      userIdEl.textContent = me.id != null ? String(me.id) : '';
      createdEl.textContent = me.createdAt || '';

      roomsListEl.innerHTML = '';
      const rooms = Array.isArray(roomsData.rooms) ? roomsData.rooms : [];
      if (rooms.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No rooms yet';
        roomsListEl.appendChild(li);
      } else {
        rooms.forEach((room) => {
          const li = document.createElement('li');
          li.textContent = room.name + (room.isOwner ? ' (owner)' : '');
          roomsListEl.appendChild(li);
        });
      }
    } catch (err) {
      setError(err.message || 'Failed to load profile.');
    }
  }

  loadProfile();
})();
