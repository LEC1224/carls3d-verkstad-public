// Starts its own loopback-only built server with disposable auth settings.
// No orders, database writes, customer data, or external notifications are used.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.cache', 'built-site-smoke');
const secret = crypto.randomBytes(32).toString('hex');
const password = crypto.randomBytes(24).toString('hex');
const checks = [];

async function availablePort() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.next/server/middleware-manifest.json'), 'utf8'));
  assert.ok(manifest.sortedMiddleware.length, 'The built site must include the admin middleware');
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ADMIN_SECRET: secret, ADMIN_PASSWORD: password, DISCORD_WEBHOOK: '', NEXT_TELEMETRY_DISABLED: '1' },
  });
  let output = '';
  let spawnError;
  server.on('error', error => { spawnError = error; });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { output = (output + data).slice(-16000); });
  const exited = new Promise(resolve => server.once('exit', resolve));
  const request = (route, options = {}) => fetch(base + route, { ...options, redirect: 'manual', signal: AbortSignal.timeout(5000) });
  async function check(name, action) {
    await action();
    checks.push({ name, passed: true });
    console.log(`PASS ${name}`);
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (spawnError) throw spawnError;
      if (server.exitCode !== null) throw new Error(`Preview server exited: ${output}`);
      try { if ((await request('/')).ok) { ready = true; break; } } catch { /* wait for startup */ }
      await delay(250);
    }
    assert.ok(ready, `Preview server did not become ready: ${output}`);

    await check('Public pages render Swedish metadata', async () => {
      for (const route of ['/', '/bestall', '/lithophane', '/minecraft-torch', '/om-kontakt']) {
        const response = await request(route);
        assert.equal(response.status, 200, route);
        const html = await response.text();
        assert.match(html, /<html[^>]*lang="sv"/, route);
        assert.match(html, /<link[^>]*rel="canonical"/, route);
        assert.match(html, /id="main-content"/, route);
      }
    });
    await check('Model viewer stays out of initial checkout HTML', async () => {
      const html = await (await request('/bestall')).text();
      const dynamic = JSON.parse(fs.readFileSync(path.join(root, '.next/react-loadable-manifest.json'), 'utf8'));
      const entry = Object.entries(dynamic).find(([key]) => key.includes('ThreeDViewer'));
      assert.ok(entry, 'Expected a lazy viewer chunk');
      for (const file of entry[1].files) assert.ok(!html.includes(file), `Viewer chunk loaded eagerly: ${file}`);
    });
    await check('Admin middleware rejects missing and invalid cookies', async () => {
      for (const headers of [{}, { cookie: 'admin_session=invalid' }]) {
        const response = await request('/admin', { headers });
        assert.equal(response.status, 307);
        const destination = new URL(response.headers.get('location'), base);
        // NextURL normalizes loopback IPs to localhost in middleware redirects.
        assert.ok(['127.0.0.1', 'localhost'].includes(destination.hostname));
        assert.equal(destination.port, String(port));
        assert.equal(destination.protocol, 'http:');
        assert.equal(destination.pathname, '/admin-login');
        assert.equal(destination.searchParams.get('next'), '/admin');
      }
    });
    await check('Node signed cookie passes the compiled Edge guard', async () => {
      const cookie = crypto.createHmac('sha256', secret).update('admin-ok').digest('base64url');
      const response = await request('/admin', { headers: { cookie: `admin_session=${cookie}` } });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /noindex/);
    });
    await check('Admin data remains private without authentication', async () => {
      for (const route of ['/api/orders', '/api/admin/inventory', '/api/admin/coupons', '/api/admin/travel-periods']) {
        const response = await request(route);
        assert.equal(response.status, 401, route);
        assert.match(response.headers.get('cache-control') || '', /no-store/, route);
      }
    });
    await check('Login guards redirect destinations and issues secure cookies', async () => {
      const response = await request('/api/admin-login?next=%2F%2Fexample.invalid', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).redirect, '/admin');
      const cookie = response.headers.get('set-cookie') || '';
      for (const flag of ['HttpOnly', 'SameSite=Lax', 'Secure']) assert.ok(cookie.includes(flag), flag);
      const bad = await request('/api/admin-login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'invalid' }),
      });
      assert.equal(bad.status, 401);
    });
    await check('Recovery page, robots and sitemap are available', async () => {
      assert.equal((await request('/missing-local-smoke-page')).status, 404);
      assert.match(await (await request('/robots.txt')).text(), /Sitemap:/);
      assert.match(await (await request('/sitemap.xml')).text(), /https:\/\/carls3d.se\/bestall/);
    });
    await check('Quote and order endpoints refuse GET requests', async () => {
      for (const route of ['/api/quote', '/api/order', '/api/lithophane', '/api/minecraft-torch']) {
        assert.equal((await request(route)).status, 405, route);
      }
    });
  } finally {
    server.kill();
    await Promise.race([exited, delay(3000)]);
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'report.json'), JSON.stringify({ time: new Date().toISOString(), checks }, null, 2));
  }
  console.log(`${checks.length} built-site checks passed; temporary server stopped.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
