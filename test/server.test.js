import test from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../src/server.js';

test('serves the browser app and health endpoint', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Личная социальная сеть/);

    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
