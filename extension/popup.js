import { summary, peopleRows, withDefaults, newState } from './core.js';
const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m);
const when = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

async function load() {
  const { settings, state } = await chrome.storage.local.get(['settings', 'state']);
  return { settings: withDefaults(settings), state: state || newState(Date.now()), raw: settings || {} };
}

async function refresh() {
  const { settings, state, raw } = await load();
  const sum = summary(state, settings);
  const ready = !!settings.firstName.trim();
  $('pill').className = 'pill ' + (state.halt ? 'stop' : !state.enabled ? '' : settings.practice ? 'reh' : 'on');
  $('pill').textContent = state.halt ? 'Stopped' : !state.enabled ? 'Off' : settings.practice ? 'Practising' : 'Running';
  $('halt').hidden = !state.halt; $('haltWhy').textContent = state.halt ? state.halt.reason : '';
  $('toggle').textContent = !ready ? 'Set up (30 seconds)' : state.enabled ? 'Stop' : 'Find people and message them';
  $('toggle').className = state.enabled && ready ? 'big' : 'primary big';
  $('status').textContent = !ready ? 'Add your first name and check your messages, then press the button.' : state.enabled ? (state.status || '') : 'Off. Nothing happens until you press the button.';
  $('sFound').textContent = sum.found; $('sInvited').textContent = sum.invited; $('sAccepted').textContent = sum.accepted; $('sMessaged').textContent = sum.messaged; $('sReplied').textContent = sum.replied;
  $('queue').textContent = `${sum.waiting} waiting to be invited. Accepted people get a message ${settings.messageDelayMinutes} minutes after they accept.`;
  $('mInvite').textContent = `${sum.today.invite.used} / ${sum.today.invite.cap}`; $('mMessage').textContent = `${sum.today.message.used} / ${sum.today.message.cap}`; $('mSearch').textContent = `${sum.today.search.used} / ${sum.today.search.cap}`;
  $('practice').checked = settings.practice;
  const log = [...state.log].reverse().slice(0, 10);
  $('log').replaceChildren(...(log.length ? log.map((e) => { const li = document.createElement('li'); if (!e.ok) li.className = 'bad'; li.textContent = `${when(e.ts)}  ${e.detail}`; return li; }) : [Object.assign(document.createElement('li'), { textContent: 'Nothing yet.', className: 'muted' })]));
  return { settings, state, raw };
}

$('toggle').onclick = async () => {
  const { settings, state, raw } = await load();
  if (!settings.firstName.trim()) return chrome.runtime.openOptionsPage();
  if (!state.enabled && !raw.agreed) {
    if (!confirm('Open Outreach clicks buttons on LinkedIn for you.\n\nLinkedIn\'s terms prohibit automation, and accounts can be restricted, even at low volume. It goes slowly and stops by itself if LinkedIn shows a warning, but it cannot make that risk zero.\n\nStart anyway?')) return;
    await chrome.storage.local.set({ settings: { ...raw, agreed: true } });
  }
  await send({ type: 'toggle', enabled: !state.enabled });
  refresh();
};
$('resume').onclick = async () => { await send({ type: 'resume' }); refresh(); };
$('practice').onchange = async (e) => { const { raw } = await load(); await chrome.storage.local.set({ settings: { ...raw, practice: e.target.checked } }); refresh(); };
$('opts').onclick = () => chrome.runtime.openOptionsPage();
$('csv').onclick = async () => {
  const { state } = await load();
  const rows = peopleRows(state);
  if (!rows.length) { $('status').textContent = 'Nobody found yet. Press the button first.'; return; }
  const cols = Object.keys(rows[0]);
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([[cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')], { type: 'text/csv' }));
  a.download = `open-outreach-people-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
};
refresh(); setInterval(refresh, 3000);
