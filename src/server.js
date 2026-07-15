import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Store } from './store.js';

const store = new Store(process.env.DB_FILE || 'data/db.json');
await store.load();
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8' };
const json = (res, code, data) => { res.writeHead(code, { 'content-type':'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
const body = req => new Promise(resolve => { let d=''; req.on('data', c => d += c); req.on('end', () => resolve(d ? JSON.parse(d) : {})); });
const token = req => req.headers.authorization?.replace('Bearer ', '');
const requireUser = req => { const u = store.userByToken(token(req)); if (!u) throw new Error('Unauthorized.'); return u; };

async function api(req, res, path) {
  try {
    const b = await body(req); let u;
    if (path === '/api/register' && req.method === 'POST') return json(res, 201, await store.register(b));
    if (path === '/api/login' && req.method === 'POST') return json(res, 200, await store.login(b));
    if (path === '/api/logout' && req.method === 'POST') return json(res, 200, await store.logout(token(req)));
    u = requireUser(req);
    if (path === '/api/me' && req.method === 'GET') return json(res, 200, u);
    if (path === '/api/profile' && req.method === 'PATCH') return json(res, 200, await store.updateProfile(u.id, b));
    if (path.startsWith('/api/users') && req.method === 'GET') return json(res, 200, store.searchUsers(new URL(req.url, 'http://x').searchParams.get('q') || ''));
    if (path === '/api/chats' && req.method === 'GET') return json(res, 200, store.chats(u.id));
    if (path === '/api/chats' && req.method === 'POST') return json(res, 201, await store.createChat(u.id, b));
    if (path.match(/^\/api\/chats\/[^/]+\/messages$/) && req.method === 'GET') return json(res, 200, store.messages(u.id, path.split('/')[3]));
    if (path.match(/^\/api\/chats\/[^/]+\/messages$/) && req.method === 'POST') return json(res, 201, await store.sendMessage(u.id, path.split('/')[3], b));
    if (path.match(/^\/api\/messages\/[^/]+$/) && req.method === 'PATCH') return json(res, 200, await store.editMessage(u.id, path.split('/')[3], b));
    if (path.match(/^\/api\/messages\/[^/]+$/) && req.method === 'DELETE') return json(res, 200, await store.deleteMessage(u.id, path.split('/')[3]));
    if (path.match(/^\/api\/messages\/[^/]+\/reactions$/) && req.method === 'POST') return json(res, 200, await store.reactToMessage(u.id, path.split('/')[3], b));
    if (path === '/api/channels' && req.method === 'GET') return json(res, 200, store.channels());
    if (path === '/api/channels' && req.method === 'POST') return json(res, 201, await store.createChannel(u.id, b));
    if (path.match(/^\/api\/channels\/[^/]+\/subscribe$/) && req.method === 'POST') return json(res, 200, await store.subscribe(u.id, path.split('/')[3]));
    if (path.match(/^\/api\/channels\/[^/]+\/posts$/) && req.method === 'GET') return json(res, 200, store.posts(path.split('/')[3]));
    if (path.match(/^\/api\/channels\/[^/]+\/posts$/) && req.method === 'POST') return json(res, 201, await store.createPost(u.id, path.split('/')[3], b));
    if (path === '/api/reports' && req.method === 'POST') return json(res, 201, await store.report(u.id, b.targetType, b.targetId, b.reason));
    if (path === '/api/notifications' && req.method === 'GET') return json(res, 200, store.notifications(u.id));
    if (path === '/api/admin' && req.method === 'GET') return json(res, 200, store.admin(u.id));
    json(res, 404, { error: 'Not found' });
  } catch (e) { json(res, e.message === 'Unauthorized.' ? 401 : 400, { error: e.message }); }
}

export const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/health') return json(res, 200, { status: 'ok' });
  if (pathname.startsWith('/api/')) return api(req, res, pathname);
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  try { const data = await readFile(join('public', file)); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end('Not found'); }
});

if (process.argv[1]?.endsWith('server.js')) {
  const port = Number(process.env.PORT || 3000);
  const hostArgIndex = process.argv.indexOf('--host');
  const hostArg = hostArgIndex === -1 ? undefined : process.argv[hostArgIndex + 1];
  const host = hostArg || process.env.HOST || '0.0.0.0';
  server.listen(port, host, () => {
    const localHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Social Network running:`);
    console.log(`- Local:   http://${localHost}:${port}`);
    if (host === '0.0.0.0') console.log(`- Network: http://<your-device-ip>:${port}`);
  });
}
