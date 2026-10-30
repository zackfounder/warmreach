// A small local program stands in for whatever talks to the bridge: it hands over a person and a message, and
// receives the snapshot and the result. The browser, the extension and the fake LinkedIn are real.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, extensionChromePath } from './helpers.js';
import { startFakeLinkedIn } from './fake-linkedin.js';
import { withDefaults, newState, DAY } from '../extension/core.js';

const exe = extensionChromePath();
const skip = exe ? false : 'no Chrome for Testing found (npx playwright-core install chromium)';

test('bridge end to end: a local program queues a message, the extension sends it, and reports back', { skip, timeout: 90000 }, async () => {
  const { chromium } = await import('playwright-core');
  const received = { snapshots: [], auth: [], marker: [] };
  let commands = [{ id: 'k1', type: 'add_people', stage: 'connected', people: [{ name: 'Rachel Kim', url: 'https://www.linkedin.com/in/first-rachel-kim' }] }, { id: 'k2', type: 'send', url: 'https://www.linkedin.com/in/first-rachel-kim', text: 'Hi Rachel, thanks for connecting. A quick question for you.' }];
  const bridge = http.createServer((req, res) => {
    received.auth.push(req.headers.authorization); received.marker.push(req.headers['x-warmreach']);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/bridge/commands') { res.end(JSON.stringify({ commands })); commands = []; return; }
    let body = '';
    req.on('data', (d) => (body += d)); req.on('end', () => { received.snapshots.push(JSON.parse(body)); res.end('{"ok":true}'); });
  });
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
  const li = await startFakeLinkedIn();
  const ext = path.join(ROOT, 'extension');
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'oo-br-')), { executablePath: exe, headless: false, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, ...li.args] });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const settings = withDefaults({ firstName: 'Alex', hours: { start: 0, end: 24, weekends: true }, searches: [], bridge: { url: `http://127.0.0.1:${bridge.address().port}/bridge`, token: 'secret-token' } });
    const state = newState(Date.now() - 30 * DAY); state.installedAt = Date.now() - 30 * DAY;
    await sw.evaluate((x) => chrome.storage.local.set(x), { settings, state, turbo: true });

    // 1. sync: the commands are applied, a snapshot goes back
    const r1 = await sw.evaluate(() => globalThis.__ooBridge());
    assert.deepEqual(r1.acks.map((a) => [a.id, a.ok]), [['k1', true], ['k2', true]]);
    assert.deepEqual(received.auth.slice(0, 2), ['Bearer secret-token', 'Bearer secret-token']);
    assert.ok(received.marker.every((m) => m === '1'), 'every request carries the marker header');
    assert.equal(received.snapshots[0].people.length, 1);
    assert.equal(received.snapshots[0].queue.length, 1);

    // 2. one step sends exactly that text on the profile
    const r2 = await sw.evaluate(() => globalThis.__ooStep({ force: true }));
    assert.equal(r2.work.queueId, 'k2'); assert.equal(r2.report.ok, true, JSON.stringify(r2));
    const page = ctx.pages().find((p) => p.url().startsWith('https://www.linkedin.com'));
    assert.deepEqual(await page.evaluate(() => window.__log), [{ kind: 'message', text: 'Hi Rachel, thanks for connecting. A quick question for you.' }]);

    // 3. the next sync reports the result and the new thread
    await sw.evaluate(() => globalThis.__ooBridge());
    const last = received.snapshots.at(-1);
    assert.deepEqual(last.outbox.map((o) => [o.id, o.ok]), [['k2', true]]);
    assert.equal(last.people[0].thread[0].text, 'Hi Rachel, thanks for connecting. A quick question for you.');
    assert.equal(last.queue.length, 0);

    // 4. an address that is not on this computer is refused
    await sw.evaluate(() => chrome.storage.local.get('settings').then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, bridge: { url: 'https://example.com/bridge', token: 'x' } } })));
    const r4 = await sw.evaluate(() => globalThis.__ooBridge());
    assert.match(r4.error, /on this computer/);
  } finally { await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 8000))]); li.close(); bridge.close(); }
});
