let token = localStorage.token;
let selectedChat = null;
let selectedChannel = null;
let mode = 'chat';
let me = null;

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const initials = value => String(value || 'SN').split(/\s|_/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
const api = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: token ? `Bearer ${token}` : '', ...(options.headers || {}) }
  });
  const json = await response.json();
  if (!response.ok) throw Error(json.error);
  return json;
};

function toast(message) { $('authMsg') ? $('authMsg').textContent = message : alert(message); }
function setActiveTitle(title, subtitle = '') { $('activeTitle').textContent = title; $('activeSubtitle').textContent = subtitle; }
function showSection(id) {
  ['chatsPanel', 'channelsPanel', 'adminPanel'].forEach(panel => $(panel).classList.toggle('hidden', panel !== id));
  document.querySelectorAll('.tabs button').forEach(button => button.classList.remove('active'));
  event?.target?.classList.add('active');
}
function showComposer(nextMode) {
  mode = nextMode;
  $('messageComposer').classList.toggle('hidden', nextMode !== 'chat');
  $('postComposer').classList.toggle('hidden', nextMode !== 'channel');
  $('messages').classList.toggle('hidden', nextMode !== 'chat');
  $('posts').classList.toggle('hidden', nextMode !== 'channel');
}

async function register() {
  try {
    await api('/api/register', { method: 'POST', body: JSON.stringify({ username: username.value, password: password.value, displayName: displayName.value }) });
    toast('🎉 Аккаунт создан. Теперь войдите.');
  } catch (error) { toast(error.message); }
}
async function login() {
  try {
    const result = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: username.value, password: password.value }) });
    token = result.token;
    localStorage.token = token;
    await init();
  } catch (error) { toast(error.message); }
}
async function init() {
  if (!token) return;
  me = await api('/api/me');
  $('auth').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('me').textContent = `@${me.username}`;
  $('profileName').textContent = me.displayName;
  $('profileMeta').textContent = `@${me.username} · ${me.role}`;
  $('bio').value = me.bio || '';
  document.querySelector('.profile-card .avatar').textContent = initials(me.displayName);
  await Promise.all([loadChats(), loadChannels(), loadNotifications()]);
}
async function saveProfile() {
  me = await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ displayName: me.displayName, bio: bio.value }) });
  $('profileMeta').textContent = `@${me.username} · ${me.role}`;
  alert('✅ Профиль сохранён');
}
async function findUsers() {
  const list = await api('/api/users?q=' + encodeURIComponent(search.value));
  users.innerHTML = list.map(user => `
    <article class="item">
      <div class="item-title"><span>${escapeHtml(user.displayName)}</span><span>👤</span></div>
      <div class="muted">@${escapeHtml(user.username)} · ${escapeHtml(user.id)}</div>
    </article>`).join('');
}
async function createChat() {
  await api('/api/chats', { method: 'POST', body: JSON.stringify({ title: chatTitle.value, memberIds: chatMembers.value.split(',').map(x => x.trim()).filter(Boolean) }) });
  chatTitle.value = ''; chatMembers.value = '';
  loadChats();
}
async function loadChats() {
  const list = await api('/api/chats');
  chats.innerHTML = list.map(chat => `
    <article class="item" onclick="openChat('${chat.id}')">
      <div class="item-title"><span>💬 ${escapeHtml(chat.title)}</span><span>${chat.memberIds.length}</span></div>
      <div class="muted">${escapeHtml(chat.id)}</div>
    </article>`).join('') || '<p class="muted">Пока нет чатов. Создайте первый ✨</p>';
}
async function openChat(id) {
  selectedChat = id;
  selectedChannel = null;
  showComposer('chat');
  const list = await api(`/api/chats/${id}/messages`);
  setActiveTitle('💬 Чат', `${list.length} сообщений · ${id}`);
  messages.classList.toggle('empty-state', !list.length);
  messages.innerHTML = list.length ? list.map(message => `
    <article class="message-bubble">
      <div>${escapeHtml(message.text)}</div>
      ${message.attachmentUrl ? `<a href="${escapeHtml(message.attachmentUrl)}" target="_blank" rel="noreferrer">📎 Вложение</a>` : ''}
      <div class="muted">${escapeHtml(message.createdAt)} · ${escapeHtml(message.id)}</div>
    </article>`).join('') : '<div>Напишите первое сообщение 👋</div>';
}
async function sendMessage() {
  if (!selectedChat) return alert('Сначала выберите чат');
  await api(`/api/chats/${selectedChat}/messages`, { method: 'POST', body: JSON.stringify({ text: messageText.value, attachmentUrl: messageFile.value }) });
  messageText.value = ''; messageFile.value = '';
  openChat(selectedChat);
}
async function createChannel() {
  await api('/api/channels', { method: 'POST', body: JSON.stringify({ title: channelTitle.value, description: channelDesc.value }) });
  channelTitle.value = ''; channelDesc.value = '';
  loadChannels();
}
async function loadChannels() {
  const list = await api('/api/channels');
  channels.innerHTML = list.map(channel => `
    <article class="item" onclick="openChannel('${channel.id}')">
      <div class="item-title"><span>📣 ${escapeHtml(channel.title)}</span><span>${channel.subscriberIds.length}</span></div>
      <p class="muted">${escapeHtml(channel.description || 'Без описания')}</p>
      <button class="secondary" onclick="event.stopPropagation();subscribe('${channel.id}')">Подписаться</button>
      <div class="muted">${escapeHtml(channel.id)}</div>
    </article>`).join('') || '<p class="muted">Каналов пока нет. Создайте свой 📣</p>';
}
async function subscribe(id) { await api(`/api/channels/${id}/subscribe`, { method: 'POST' }); loadChannels(); loadNotifications(); }
async function openChannel(id) {
  selectedChannel = id;
  selectedChat = null;
  showComposer('channel');
  const list = await api(`/api/channels/${id}/posts`);
  setActiveTitle('📣 Канал', `${list.length} публикаций · ${id}`);
  posts.classList.toggle('empty-state', !list.length);
  posts.innerHTML = list.length ? list.map(post => `
    <article class="post-card">
      <strong>Публикация</strong>
      <p>${escapeHtml(post.text)}</p>
      ${post.attachmentUrl ? `<a href="${escapeHtml(post.attachmentUrl)}" target="_blank" rel="noreferrer">📎 Вложение</a>` : ''}
      <div class="muted">${escapeHtml(post.createdAt)} · ${escapeHtml(post.id)}</div>
    </article>`).join('') : '<div>В канале пока нет публикаций ✨</div>';
}
async function createPost() {
  if (!selectedChannel) return alert('Сначала выберите канал');
  await api(`/api/channels/${selectedChannel}/posts`, { method: 'POST', body: JSON.stringify({ text: postText.value, attachmentUrl: postFile.value }) });
  postText.value = ''; postFile.value = '';
  openChannel(selectedChannel);
}
async function report() {
  await api('/api/reports', { method: 'POST', body: JSON.stringify({ targetType: targetType.value, targetId: targetId.value, reason: reason.value }) });
  alert('🚨 Жалоба отправлена');
}
async function loadNotifications() {
  const list = await api('/api/notifications');
  notifications.innerHTML = list.map(notification => `
    <div class="notification">
      <strong>${escapeHtml(notification.type)}</strong>
      <p>${escapeHtml(notification.text)}</p>
      <div class="muted">${escapeHtml(notification.createdAt)}</div>
    </div>`).join('') || '<p class="muted">Пока тихо 🔕</p>';
}
async function loadAdmin() {
  try { admin.textContent = JSON.stringify(await api('/api/admin'), null, 2); }
  catch (error) { admin.textContent = error.message; }
}

init().catch(() => localStorage.removeItem('token'));
