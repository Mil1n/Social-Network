let token = localStorage.token;
let selectedChat = null;
let selectedChannel = null;
let mode = 'chat';
let me = null;
let replyToId = '';
let activeItemId = '';
const toastStack = document.createElement('div');
toastStack.className = 'toast-stack';
document.body.appendChild(toastStack);
if (localStorage.theme === 'dark') document.body.classList.add('dark');

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

function toast(message) { const node = document.createElement('div'); node.className = 'toast'; node.textContent = message; toastStack.appendChild(node); setTimeout(() => node.remove(), 2600); if ($('authMsg')) $('authMsg').textContent = message; }
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


function toggleTheme() { document.body.classList.toggle('dark'); localStorage.theme = document.body.classList.contains('dark') ? 'dark' : 'light'; }
async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('token');
  token = '';
  location.reload();
}
function setReply(id) {
  replyToId = id;
  $('replyPreview').textContent = `Ответ на сообщение ${id}`;
  $('replyPreview').classList.remove('hidden');
  messageText.focus();
}
function clearReply() { replyToId = ''; $('replyPreview').classList.add('hidden'); $('replyPreview').textContent = ''; }
async function editMessage(id) {
  const text = prompt('Редактировать сообщение');
  if (text === null) return;
  await api(`/api/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ text }) });
  toast('✏️ Сообщение обновлено');
  openChat(selectedChat);
}
async function deleteMessage(id) {
  if (!confirm('Удалить сообщение?')) return;
  await api(`/api/messages/${id}`, { method: 'DELETE' });
  toast('🗑️ Сообщение удалено');
  openChat(selectedChat);
}
async function reactToMessage(id, emoji) {
  await api(`/api/messages/${id}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) });
  openChat(selectedChat);
}
const reactionHtml = message => ['👍','❤️','😂','🔥','👀'].map(emoji => `<button onclick="reactToMessage('${message.id}','${emoji}')">${emoji} ${message.reactions?.[emoji]?.length || ''}</button>`).join('');

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
  await Promise.all([loadChats(), loadChannels(), loadNotifications(), loadContacts()]);
}
async function saveProfile() {
  me = await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ displayName: me.displayName, bio: bio.value }) });
  $('profileMeta').textContent = `@${me.username} · ${me.role}`;
  toast('✅ Профиль сохранён');
}
async function findUsers() {
  const list = await api('/api/users?q=' + encodeURIComponent(search.value));
  users.innerHTML = list.map(user => `
    <article class="item">
      <div class="item-title"><span>${escapeHtml(user.displayName)}</span><span>👤</span></div>
      <div class="muted">@${escapeHtml(user.username)} · ${escapeHtml(user.id)}</div>
      <div class="inline-actions"><button class="secondary" onclick="requestContact('${user.id}')">+ Контакт</button><button onclick="startDirectChat('${user.id}')">Написать</button></div>
    </article>`).join('');
}

async function loadContacts() {
  const list = await api('/api/contacts');
  contacts.innerHTML = list.map(contact => `
    <article class="item">
      <div class="item-title"><span>${escapeHtml(contact.user?.displayName || 'Пользователь')}</span><span>${escapeHtml(contact.status)}</span></div>
      <div class="muted">@${escapeHtml(contact.user?.username || '')}</div>
      <div class="inline-actions">
        ${contact.status === 'pending' && contact.addresseeId === me.id ? `<button onclick="respondContact('${contact.id}','accepted')">✅ Принять</button><button class="secondary" onclick="respondContact('${contact.id}','rejected')">Отклонить</button>` : ''}
        ${contact.status === 'accepted' ? `<button onclick="startDirectChat('${contact.user.id}')">💬 Написать</button>` : ''}
      </div>
    </article>`).join('') || '<p class="muted">Контактов пока нет 👋</p>';
}
async function requestContact(targetUserId) { await api('/api/contacts', { method: 'POST', body: JSON.stringify({ targetUserId }) }); toast('👥 Запрос отправлен'); loadContacts(); }
async function respondContact(contactId, status) { await api(`/api/contacts/${contactId}`, { method: 'PATCH', body: JSON.stringify({ status }) }); toast('✅ Контакт обновлён'); loadContacts(); }
async function startDirectChat(targetUserId) { const chat = await api('/api/direct-chats', { method: 'POST', body: JSON.stringify({ targetUserId }) }); await loadChats(); openChat(chat.id); showSection('chatsPanel'); }

async function createChat() {
  await api('/api/chats', { method: 'POST', body: JSON.stringify({ title: chatTitle.value, memberIds: chatMembers.value.split(',').map(x => x.trim()).filter(Boolean) }) });
  chatTitle.value = ''; chatMembers.value = '';
  loadChats();
}
async function loadChats() {
  const list = await api('/api/chats');
  chats.innerHTML = list.map(chat => `
    <article class="item ${activeItemId === chat.id ? 'active-item' : ''}" onclick="openChat('${chat.id}')">
      <div class="item-title"><span>💬 ${escapeHtml(chat.title)}</span><span>${chat.unreadCount ? `<b class='unread-badge'>${chat.unreadCount}</b>` : chat.memberIds.length}</span></div>
      <div class="muted">${escapeHtml(chat.id)}</div>
    </article>`).join('') || '<p class="muted">Пока нет чатов. Создайте первый ✨</p>';
}
async function openChat(id) {
  selectedChat = id;
  activeItemId = id;
  selectedChannel = null;
  clearReply();
  showComposer('chat');
  const list = await api(`/api/chats/${id}/messages`);
  setActiveTitle('💬 Чат', `${list.length} сообщений · ${id}`);
  messages.classList.toggle('empty-state', !list.length);
  messages.innerHTML = list.length ? list.map(message => `
    <article class="message-bubble">
      ${message.replyToId ? `<div class="reply-preview">↩️ Ответ на ${escapeHtml(message.replyToId)}</div>` : ''}
      <div>${escapeHtml(message.text)}</div>
      ${message.attachmentUrl ? `<a href="${escapeHtml(message.attachmentUrl)}" target="_blank" rel="noreferrer">📎 Вложение</a>` : ''}
      <div class="muted">${escapeHtml(message.createdAt)}${message.editedAt ? ' · edited' : ''} · ${escapeHtml(message.id)}</div>
      <div class="message-actions">${reactionHtml(message)}<button onclick="setReply('${message.id}')">↩️ Ответить</button>${message.authorId === me.id && !message.deletedAt ? `<button onclick="editMessage('${message.id}')">✏️</button><button onclick="deleteMessage('${message.id}')">🗑️</button>` : ''}</div>
    </article>`).join('') : '<div>Напишите первое сообщение 👋</div>';
  loadChats();
}
async function sendMessage() {
  if (!selectedChat) return alert('Сначала выберите чат');
  await api(`/api/chats/${selectedChat}/messages`, { method: 'POST', body: JSON.stringify({ text: messageText.value, attachmentUrl: messageFile.value, replyToId }) });
  messageText.value = ''; messageFile.value = ''; clearReply();
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
  activeItemId = id;
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
  toast('🚨 Жалоба отправлена');
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
