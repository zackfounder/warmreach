// Open Outreach: once a minute, ask the core "what next?", do exactly that in a LinkedIn tab, and record what happened.
// Everything lives in chrome.storage.local on this computer. Nothing is sent anywhere except to LinkedIn itself.
import { nextWork, applyReport, newState, withDefaults, applyCommands, snapshot } from './core.js';
import { parseCapture } from './parse.js';

const LINKEDIN = 'https://www.linkedin.com';
const rand = (a, b) => a + Math.random() * (b - a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const loadSettings = async () => withDefaults((await chrome.storage.local.get('settings')).settings);
const loadState = async () => (await chrome.storage.local.get('state')).state || newState(Date.now());
const saveState = (state) => chrome.storage.local.set({ state });

// ---- the LinkedIn tab we drive ------------------------------------------------------------------
async function workerTab(url, active) {
  const { workerTabId } = await chrome.storage.local.get('workerTabId');
  const existing = workerTabId ? await chrome.tabs.get(workerTabId).catch(() => null) : null;
  let creating = null;
  const loaded = new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(on); clearTimeout(timer); resolve(); };
    const on = (id, info) => { if (id === (existing?.id ?? creating) && info.status === 'complete') done(); };
    const timer = setTimeout(done, 45000);
    chrome.tabs.onUpdated.addListener(on);
  });
  let tab;
  if (existing) tab = await chrome.tabs.update(existing.id, { url, active });
  else { tab = await chrome.tabs.create({ url, active }); creating = tab.id; }
  await chrome.storage.local.set({ workerTabId: tab.id });
  await loaded;
  return tab.id;
}
async function closeWorkerTab() {
  const { workerTabId } = await chrome.storage.local.get('workerTabId');
  if (workerTabId) await chrome.tabs.remove(workerTabId).catch(() => {});
  await chrome.storage.local.remove('workerTabId');
}
async function runOnTab(url, action, params, watch = false) {
  const { turbo } = await chrome.storage.local.get('turbo'); // tests only
  const tabId = await workerTab(url, watch);
  if (!turbo) await wait(rand(2000, 5000));
  for (let i = 0; i < 12; i++) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'oo-run', action, params, speed: turbo ? 0.01 : 1 });
      if (r) return r;
    } catch { /* the page is still loading */ }
    await wait(turbo ? 100 : 1000);
  }
  return { ok: false, code: 'not_found', detail: 'The LinkedIn page did not respond. Are you logged in to LinkedIn in this browser?' };
}

// ---- one unit of work ---------------------------------------------------------------------------
async function perform(w) {
  if (w.type === 'send') {
    const r = w.kind === 'invite'
      ? await runOnTab(w.url, 'sendInvite', { rehearse: w.rehearsal }, w.rehearsal)
      : await runOnTab(w.url, 'sendMessage', { text: w.text, rehearse: w.rehearsal }, w.rehearsal);
    return { type: 'send', kind: w.kind, key: w.key, variant: w.variant, variantName: w.variantName, text: w.text, queueId: w.queueId, ...r };
  }
  if (w.type === 'accepts') return { type: 'accepts', ...(await runOnTab(`${LINKEDIN}/mynetwork/invite-connect/connections/`, 'readConnections', {})) };
  if (w.type === 'replies') return { type: 'replies', ...(await runOnTab(`${LINKEDIN}/messaging/`, 'readInbox', {})) };
  if (w.type === 'search') {
    const r = await runOnTab(w.url, 'searchPage', {});
    return { type: 'search', query: w.query, ...r, people: r.ok ? parseCapture(r.payload) : [] };
  }
  return null;
}

// ---- the optional local bridge: another program on this computer reads the snapshot and hands over commands ----
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i;
let syncing = false;
async function bridgeSync() {
  if (syncing) return { skipped: 'busy' };
  const settings = await loadSettings();
  const { url, token } = settings.bridge;
  if (!url) return { skipped: 'off' };
  if (!LOCAL.test(url)) return { error: 'The bridge address must be on this computer (127.0.0.1 or localhost).' };
  syncing = true;
  const base = url.replace(/\/+$/, '');
  // x-open-outreach: a header a web page cannot send without a preflight the local program refuses, so other websites cannot talk to it.
  const headers = { 'content-type': 'application/json', 'x-open-outreach': '1', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  try {
    let acks = [];
    const got = await fetch(base + '/commands', { headers, signal: AbortSignal.timeout(4000) });
    if (got.ok) {
      const { commands } = await got.json();
      if (Array.isArray(commands) && commands.length) {
        const out = applyCommands(await loadState(), commands, Date.now());
        await saveState(out.state); acks = out.acks;
        if (out.state.enabled && !(await loadState()).halt) setTimeout(() => step(), 500);
      }
    }
    const state = await loadState();
    const res = await fetch(base + '/snapshot', { method: 'POST', headers, body: JSON.stringify({ ...snapshot(state, settings, Date.now()), outbox: state.outbox || [], acks }), signal: AbortSignal.timeout(4000) });
    if (res.ok && (state.outbox || []).length) await saveState({ ...(await loadState()), outbox: [] });
    return { ok: res.ok, acks };
  } catch (e) {
    return { error: String(e.message || e) };
  } finally { syncing = false; }
}
globalThis.__ooBridge = bridgeSync; // tests

let busy = false;
async function step({ force = false } = {}) {
  if (busy) return { skipped: 'busy' };
  busy = true;
  try {
    let state = await loadState();
    if (!state.enabled && !force) return { skipped: 'off' };
    const settings = await loadSettings();
    const w = nextWork(state, settings, Date.now());
    if (w.type === 'halted') {
      if (!state.notifiedHalt) {
        chrome.notifications.create({ type: 'basic', iconUrl: 'icon128.png', title: 'Open Outreach stopped', message: w.halt.reason });
        state = { ...state, notifiedHalt: true };
      }
      state = { ...state, status: 'Stopped: ' + w.halt.reason };
      await saveState(state);
      return { work: w };
    }
    if (w.type === 'idle') { await saveState({ ...state, notifiedHalt: false, status: w.reason }); return { work: w }; }
    await saveState({ ...state, notifiedHalt: false, status: `Working: ${w.type === 'send' ? w.kind : w.type}${w.rehearsal ? ' (practice)' : ''}` });
    const report = await perform(w);
    // Reload before applying: the popup may have changed the state (Stop, Resume) while the page was open.
    const fresh = await loadState();
    const next = applyReport(fresh, settings, report, Date.now());
    const { turbo } = await chrome.storage.local.get('turbo');
    if (turbo) next.nextActionAt = 0; // tests only: no waiting between steps
    next.status = next.halt ? 'Stopped: ' + next.halt.reason : `Done: ${w.type === 'send' ? w.kind : w.type}`;
    await saveState(next);
    if (next.halt && !fresh.halt) {
      chrome.notifications.create({ type: 'basic', iconUrl: 'icon128.png', title: 'Open Outreach stopped', message: next.halt.reason });
      await saveState({ ...next, notifiedHalt: true });
    }
    return { work: w, report, state: next };
  } catch (e) {
    const s = await loadState();
    await saveState({ ...s, status: 'Error: ' + (e.message || e) });
    return { error: String(e.message || e) };
  } finally {
    busy = false;
  }
}
globalThis.__ooStep = step; // tests drive one step directly

const ensureAlarm = () => chrome.alarms.create('oo-tick', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'oo-tick') { bridgeSync().then(() => step()); } });
chrome.runtime.onInstalled.addListener((d) => { ensureAlarm(); if (d.reason === 'install') chrome.runtime.openOptionsPage(); });
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === 'toggle') {
      const s = await loadState();
      const next = { ...s, enabled: !!msg.enabled, notifiedHalt: false, status: msg.enabled ? 'Starting...' : 'Stopped by you' };
      await saveState(next);
      if (!msg.enabled) await closeWorkerTab();
      else step();
      return reply({ ok: true });
    }
    if (msg.type === 'resume') {
      const s = await loadState();
      const people = { ...s.people };
      for (const k of Object.keys(people)) if (people[k].attempts) people[k] = { ...people[k], attempts: 0 };
      await saveState({ ...s, people, halt: null, failures: 0, notifiedHalt: false, nextActionAt: 0, log: [...s.log.slice(-79), { ts: Date.now(), ok: true, detail: 'Resumed by you' }] });
      return reply({ ok: true });
    }
    if (msg.type === 'step') return reply({ ok: true, ...(await step({ force: true })) });
    if (msg.type === 'reset') { await chrome.storage.local.remove(['state', 'workerTabId']); await closeWorkerTab(); return reply({ ok: true }); }
    reply({ ok: false, error: 'unknown message' });
  })();
  return true;
});
