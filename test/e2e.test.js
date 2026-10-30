// Loads the real extension into a real Chrome and runs it against a local stand-in for LinkedIn (test/fixtures/li.html).
// It proves the whole loop works end to end and that it stops on warnings. It does not prove LinkedIn's real pages match.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, extensionChromePath } from './helpers.js';
import { startFakeLinkedIn } from './fake-linkedin.js';
import { withDefaults, newState, DAY } from '../extension/core.js';

const exe = extensionChromePath();
const skip = exe ? false : 'no Chrome for Testing found (npx playwright-core install chromium)';

async function launch() {
  const { chromium } = await import('playwright-core');
  const li = await startFakeLinkedIn();
  const ext = path.join(ROOT, 'extension');
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'oo-')), { executablePath: exe, headless: false, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, ...li.args] });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
  const close = async () => { await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 8000))]); li.close(); };
  return { ctx, sw, li, close };
}

const T = () => Date.now();
const mk = (n, name, patch = {}) => ({ key: `www.linkedin.com/in/${n}`.replace('www.', ''), name, first: name.split(' ')[0], url: `https://www.linkedin.com/in/${n}`, headline: '', company: '', stage: 'found', foundAt: T(), ...patch });

test('the whole loop in a real Chrome: message on accept, follow-up, reply, invite, accept check, search, stop on a warning', { skip, timeout: 120000 }, async () => {
  const { ctx, sw, li, close } = await launch();
  try {
    const settings = withDefaults({ firstName: 'Alex', searches: ['solo founder'], hours: { start: 0, end: 24, weekends: true }, messageDelayMinutes: 60, agreed: true });
    const state = newState(T() - 30 * DAY);
    state.installedAt = T() - 30 * DAY;
    const people = [
      mk('connect-jonas-weber', 'Jonas Weber'),                                                                        // found: will be invited
      mk('first-rachel-kim', 'Rachel Kim', { stage: 'connected', connectedAt: T() - 2 * DAY }),                      // accepted: gets the first message
      mk('first-ana-silva', 'Ana Silva', { stage: 'messaged', messagedAt: T() - 5 * DAY, invitedAt: T() - 9 * DAY, connectedAt: T() - 8 * DAY, variant: 0, variantName: 'Question' }), // quiet: gets a follow-up
    ];
    for (const p of people) state.people[p.key] = p;
    await sw.evaluate((x) => chrome.storage.local.set(x), { settings, state, turbo: true });
    const step = () => sw.evaluate(() => globalThis.__ooStep({ force: true }));
    const get = async () => (await sw.evaluate(() => chrome.storage.local.get('state'))).state;
    const page = () => ctx.pages().find((p) => p.url().startsWith('https://www.linkedin.com'));
    const log = async () => (await page().evaluate(() => window.__log)).map((e) => (e.text ? { ...e, text: e.text.replace(/\n{3,}/g, '\n\n') } : e));

    // 1. Rachel accepted: her first message is typed and sent
    let r = await step();
    assert.equal(r.work.kind, 'message'); assert.equal(r.work.name, 'Rachel Kim');
    assert.deepEqual(await log(), [{ kind: 'message', text: "Thanks for connecting, Rachel. I'm Alex and I'm building something for founders. Would you be open to giving me honest feedback on it?" }], 'the version used least so far (Ana already got the Question one)');
    let st = await get();
    assert.equal(st.people['linkedin.com/in/first-rachel-kim'].stage, 'messaged');
    assert.equal(st.people['linkedin.com/in/first-rachel-kim'].variantName, 'Feedback');

    // 2. Ana has been quiet for 5 days: one follow-up
    r = await step();
    assert.equal(r.work.kind, 'followup');
    assert.deepEqual(await log(), [{ kind: 'message', text: 'Hey Ana, no pressure at all. Just checking you saw my message. Happy to keep it short.' }]);
    st = await get();
    assert.equal(st.people['linkedin.com/in/first-ana-silva'].followups.length, 1);

    // 3. Who replied: Rachel did; Ana's thread ends with our own message, so she did not
    r = await step();
    assert.equal(r.work.type, 'replies');
    st = await get();
    assert.equal(st.people['linkedin.com/in/first-rachel-kim'].stage, 'replied');
    assert.equal(st.people['linkedin.com/in/first-ana-silva'].stage, 'messaged');

    // 4. Jonas gets a plain Connect, no note
    r = await step();
    assert.equal(r.work.kind, 'invite');
    assert.deepEqual(await log(), [{ kind: 'invite', note: '' }]);
    assert.equal((await get()).people['linkedin.com/in/connect-jonas-weber'].stage, 'invited');

    // 5. Jonas is in the connections list: accepted
    r = await step();
    assert.equal(r.work.type, 'accepts');
    assert.equal((await get()).people['linkedin.com/in/connect-jonas-weber'].stage, 'connected');

    // 6. Nothing left to send, so it searches and saves everyone it finds, skipping nobody silently
    r = await step();
    assert.equal(r.work.type, 'search');
    st = await get();
    assert.ok(Object.keys(st.people).length >= 6, `people saved: ${Object.keys(st.people).length}`);
    assert.ok(Object.values(st.people).some((p) => p.name === 'Rachel Kim' && p.stage === 'replied'), 'a person already known is not duplicated');

    // 7. A warning page stops everything
    const warned = mk('restricted-bob-test', 'Bob Test', { foundAt: 0 });
    st = await get(); st.people[warned.key] = warned; st.nextActionAt = 0;
    await sw.evaluate((x) => chrome.storage.local.set({ state: x }), st);
    r = await step();
    assert.equal(r.work.kind, 'invite'); assert.equal(r.work.name, 'Bob Test');
    st = await get();
    assert.match(st.halt.reason, /restricted/);
    r = await step();
    assert.equal(r.work.type, 'halted');
    assert.equal(st.people[warned.key].stage, 'found', 'nobody was marked as invited on the warning page');
    assert.ok(li.hits.some((h) => h.startsWith('/in/connect-jonas-weber')), 'the browser only talked to the fake LinkedIn');
  } finally { await close(); }
});

test('popup: first run asks for a name, one button starts it, and a stop shows with a resume button', { skip }, async () => {
  const { ctx, sw, close } = await launch();
  try {
    const id = new URL(sw.url()).host;
    await sw.evaluate(() => chrome.storage.local.set({ turbo: true, settings: { hours: { start: 0, end: 24, weekends: true } } }));
    const page = await ctx.newPage();
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    await page.goto(`chrome-extension://${id}/popup.html`);
    await page.locator('#toggle').filter({ hasText: 'Set up' }).waitFor();
    // with a name, the same button becomes the one button
    await sw.evaluate(() => chrome.storage.local.set({ settings: { firstName: 'Alex', hours: { start: 0, end: 24, weekends: true }, searches: [] } }));
    await page.locator('#toggle').filter({ hasText: 'Find people and message them' }).waitFor({ timeout: 8000 });
    await page.locator('#toggle').click();
    await page.locator('#pill').filter({ hasText: 'Running' }).waitFor({ timeout: 8000 });
    assert.match(dialogs[0], /terms prohibit automation/, 'it warns once before the first start');
    // a stop from LinkedIn shows up with its reason
    await sw.evaluate(() => chrome.storage.local.get('state').then(({ state }) => chrome.storage.local.set({ state: { ...state, halt: { code: 'restricted', at: Date.now(), reason: 'LinkedIn showed "restricted": test' } } })));
    await page.locator('#halt').waitFor({ timeout: 8000 });
    await page.locator('#pill').filter({ hasText: 'Stopped' }).waitFor();
    await page.locator('#resume').click();
    await page.locator('#halt').waitFor({ state: 'hidden', timeout: 8000 });
    await page.locator('#toggle').click();
    await page.locator('#pill').filter({ hasText: 'Off' }).waitFor({ timeout: 8000 });
    assert.equal(dialogs.length, 1, 'the warning is shown only the first time');
  } finally { await close(); }
});
