import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';

test('registers users, creates chats, messages and admin reports', async () => {
  const store = new Store('/tmp/social-network-test-' + Date.now() + '.json');
  await store.load();
  const admin = await store.register({ username: 'admin_user', password: 'password1', displayName: 'Admin' });
  const user = await store.register({ username: 'demo_user', password: 'password2', displayName: 'Demo' });
  assert.equal(admin.role, 'admin');
  const chat = await store.createChat(admin.id, { title: 'Team', memberIds: [user.id] });
  const msg = await store.sendMessage(user.id, chat.id, { text: 'Hello' });
  assert.equal(store.messages(admin.id, chat.id)[0].id, msg.id);
  await store.report(user.id, 'message', msg.id, 'spam');
  assert.equal(store.admin(admin.id).reports.length, 1);
});

test('supports channels, subscriptions and posts', async () => {
  const store = new Store('/tmp/social-network-test-' + Date.now() + '-2.json');
  await store.load();
  const owner = await store.register({ username: 'owner_user', password: 'password1' });
  const subscriber = await store.register({ username: 'subscriber_user', password: 'password2' });
  const channel = await store.createChannel(owner.id, { title: 'News', description: 'Updates' });
  await store.subscribe(subscriber.id, channel.id);
  const post = await store.createPost(owner.id, channel.id, { text: 'First post' });
  assert.equal(store.posts(channel.id)[0].id, post.id);
  assert.equal(store.notifications(subscriber.id).length, 1);
});
