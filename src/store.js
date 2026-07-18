import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const createEmptyDb = () => ({ users: [], sessions: [], chats: [], messages: [], channels: [], posts: [], contacts: [], reports: [], blocks: [], notifications: [], auditLogs: [] });
const hash = value => createHash('sha256').update(value).digest('hex');
const publicUser = u => u && ({ id: u.id, username: u.username, displayName: u.displayName, bio: u.bio, role: u.role, createdAt: u.createdAt });
const sameMembers = (a, b) => a.length === b.length && a.every(id => b.includes(id));

export class Store {
  constructor(file) { this.file = file; this.db = createEmptyDb(); }
  async load() { try { this.db = { ...createEmptyDb(), ...JSON.parse(await readFile(this.file, 'utf8')) }; } catch { await this.save(); } }
  async save() { await mkdir(dirname(this.file), { recursive: true }); await writeFile(this.file, JSON.stringify(this.db, null, 2)); }
  async register({ username, password, displayName }) {
    username = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('Username must be 3-24 chars: a-z, 0-9 or _.');
    if (String(password || '').length < 8) throw new Error('Password must contain at least 8 characters.');
    if (this.db.users.some(u => u.username === username)) throw new Error('Username already exists.');
    const user = { id: randomUUID(), username, displayName: displayName || username, bio: '', passwordHash: hash(password), role: this.db.users.length ? 'user' : 'admin', createdAt: new Date().toISOString() };
    this.db.users.push(user); this.audit(user.id, 'register', { username }); await this.save(); return publicUser(user);
  }
  async login({ username, password }) { const u = this.db.users.find(x => x.username === String(username || '').toLowerCase() && x.passwordHash === hash(password || '')); if (!u) throw new Error('Invalid username or password.'); const token = randomUUID(); this.db.sessions.push({ token, userId: u.id, createdAt: new Date().toISOString() }); await this.save(); return { token, user: publicUser(u) }; }
  async logout(token) { this.db.sessions = this.db.sessions.filter(s => s.token !== token); await this.save(); return { ok: true }; }
  userByToken(token) { const s = this.db.sessions.find(x => x.token === token); return publicUser(this.db.users.find(u => u.id === s?.userId)); }
  async updateProfile(userId, patch) { const u = this.db.users.find(x => x.id === userId); u.displayName = String(patch.displayName || u.displayName).slice(0,60); u.bio = String(patch.bio || '').slice(0,240); await this.save(); return publicUser(u); }
  searchUsers(q='') { q = q.toLowerCase(); return this.db.users.filter(u => u.username.includes(q) || u.displayName.toLowerCase().includes(q)).slice(0,20).map(publicUser); }
  async createChat(userId, { title, memberIds=[], type='group' }) { const chat = { id: randomUUID(), type, title: title || 'New chat', memberIds: [...new Set([userId, ...memberIds])], createdBy: userId, createdAt: new Date().toISOString(), lastReadBy: { [userId]: new Date().toISOString() } }; this.db.chats.push(chat); await this.save(); return chat; }
  async directChat(userId, targetUserId) { const target = this.db.users.find(u => u.id === targetUserId); if (!target || target.id === userId) throw new Error('User not found.'); const members = [userId, targetUserId]; const existing = this.db.chats.find(c => c.type === 'direct' && sameMembers(c.memberIds, members)); if (existing) return existing; return this.createChat(userId, { title: target.displayName, memberIds: [targetUserId], type: 'direct' }); }
  async requestContact(userId, targetUserId) { if (userId === targetUserId) throw new Error('Cannot add yourself.'); if (!this.db.users.some(u => u.id === targetUserId)) throw new Error('User not found.'); const existing = this.db.contacts.find(c => sameMembers([c.requesterId, c.addresseeId], [userId, targetUserId])); if (existing) return existing; const c = { id: randomUUID(), requesterId: userId, addresseeId: targetUserId, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; this.db.contacts.push(c); this.notify(targetUserId, 'contact', 'Новый запрос в контакты'); await this.save(); return c; }
  async respondContact(userId, contactId, status) { if (!['accepted','rejected'].includes(status)) throw new Error('Invalid contact status.'); const c = this.db.contacts.find(x => x.id === contactId && x.addresseeId === userId); if (!c) throw new Error('Contact request not found.'); c.status = status; c.updatedAt = new Date().toISOString(); this.notify(c.requesterId, 'contact', `Запрос в контакты: ${status}`); await this.save(); return c; }
  contacts(userId) { return this.db.contacts.filter(c => c.requesterId === userId || c.addresseeId === userId).map(c => ({ ...c, user: publicUser(this.db.users.find(u => u.id === (c.requesterId === userId ? c.addresseeId : c.requesterId))) })); }
  chats(userId) { return this.db.chats.filter(c => c.memberIds.includes(userId)).map(c => ({ ...c, unreadCount: this.db.messages.filter(m => m.chatId === c.id && m.authorId !== userId && !m.deletedAt && new Date(m.createdAt) > new Date(c.lastReadBy?.[userId] || 0)).length })); }
  async sendMessage(userId, chatId, { text, attachmentUrl='', replyToId='' }) { const c = this.db.chats.find(x => x.id === chatId && x.memberIds.includes(userId)); if (!c) throw new Error('Chat not found.'); const m = { id: randomUUID(), chatId, authorId: userId, text: String(text||'').slice(0,4000), attachmentUrl: String(attachmentUrl||''), replyToId: replyToId || '', reactions: {}, readBy: [userId], createdAt: new Date().toISOString(), editedAt: '', deletedAt: '' }; this.db.messages.push(m); c.memberIds.filter(id=>id!==userId).forEach(id=>this.notify(id,'message',`${c.title}: ${m.text.slice(0,80)}`)); await this.save(); return m; }
  async editMessage(userId, messageId, { text }) { const m = this.db.messages.find(x => x.id === messageId && x.authorId === userId && !x.deletedAt); if (!m) throw new Error('Message not found or not editable.'); m.text = String(text || '').slice(0,4000); m.editedAt = new Date().toISOString(); await this.save(); return m; }
  async deleteMessage(userId, messageId) { const m = this.db.messages.find(x => x.id === messageId && x.authorId === userId && !x.deletedAt); if (!m) throw new Error('Message not found or not deletable.'); m.deletedAt = new Date().toISOString(); m.text = 'Сообщение удалено'; m.attachmentUrl = ''; await this.save(); return m; }
  async reactToMessage(userId, messageId, { emoji }) { const allowed = ['👍','❤️','😂','🔥','👀']; if (!allowed.includes(emoji)) throw new Error('Unsupported reaction.'); const m = this.db.messages.find(x => x.id === messageId && !x.deletedAt); if (!m) throw new Error('Message not found.'); m.reactions ||= {}; m.reactions[emoji] ||= []; m.reactions[emoji] = m.reactions[emoji].includes(userId) ? m.reactions[emoji].filter(id => id !== userId) : [...m.reactions[emoji], userId]; await this.save(); return m; }
  messages(userId, chatId) { const c = this.db.chats.find(x => x.id === chatId && x.memberIds.includes(userId)); if (!c) throw new Error('Chat not found.'); c.lastReadBy ||= {}; c.lastReadBy[userId] = new Date().toISOString(); return this.db.messages.filter(m => m.chatId === chatId); }
  async createChannel(userId, { title, description='' }) { const ch = { id: randomUUID(), title, description, ownerId: userId, subscriberIds: [userId], createdAt: new Date().toISOString() }; this.db.channels.push(ch); await this.save(); return ch; }
  channels() { return this.db.channels; }
  async subscribe(userId, channelId) { const ch = this.db.channels.find(c=>c.id===channelId); if (!ch) throw new Error('Channel not found.'); if (!ch.subscriberIds.includes(userId)) ch.subscriberIds.push(userId); await this.save(); return ch; }
  async createPost(userId, channelId, { text, attachmentUrl='' }) { const ch = this.db.channels.find(c=>c.id===channelId && c.ownerId===userId); if (!ch) throw new Error('Only channel owner can post.'); const p = { id: randomUUID(), channelId, authorId: userId, text: String(text||'').slice(0,8000), attachmentUrl, reactions: {}, createdAt: new Date().toISOString() }; this.db.posts.push(p); ch.subscriberIds.filter(id=>id!==userId).forEach(id=>this.notify(id,'post',`${ch.title}: ${p.text.slice(0,80)}`)); await this.save(); return p; }
  posts(channelId) { return this.db.posts.filter(p=>p.channelId===channelId); }
  async report(userId, targetType, targetId, reason) { const r = { id: randomUUID(), reporterId: userId, targetType, targetId, reason: String(reason||'').slice(0,500), status: 'open', createdAt: new Date().toISOString() }; this.db.reports.push(r); this.audit(userId,'report',r); await this.save(); return r; }
  admin(userId) { if (this.db.users.find(u=>u.id===userId)?.role !== 'admin') throw new Error('Admin only.'); return { users: this.db.users.map(publicUser), reports: this.db.reports, auditLogs: this.db.auditLogs }; }
  notify(userId,type,text){ this.db.notifications.push({ id: randomUUID(), userId, type, text, read:false, createdAt:new Date().toISOString() }); }
  notifications(userId){ return this.db.notifications.filter(n=>n.userId===userId).slice(-50).reverse(); }
  audit(userId, action, meta){ this.db.auditLogs.push({ id: randomUUID(), userId, action, meta, createdAt:new Date().toISOString() }); }
}
