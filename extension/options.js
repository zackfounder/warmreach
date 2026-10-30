import { withDefaults, summary, peopleRows, newState, addPeople, DEFAULT_MESSAGES } from './core.js';
import { parsePeopleCsv } from './parse.js';
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
let settings, messages;

async function load() {
  const got = await chrome.storage.local.get(['settings', 'state']);
  settings = withDefaults(got.settings);
  messages = JSON.parse(JSON.stringify(settings.messages));
  fill();
  results(got.state || newState(Date.now()));
}

function fill() {
  $('firstName').value = settings.firstName; $('calendarLink').value = settings.calendarLink;
  $('searches').value = settings.searches.join('\n');
  $('followups').value = String(settings.followups); $('followupDays').value = settings.followupDays; $('messageDelayMinutes').value = settings.messageDelayMinutes;
  $('invite').value = settings.limits.invite; $('message').value = settings.limits.message; $('searchPagesPerDay').value = settings.searchPagesPerDay;
  $('start').value = settings.hours.start; $('end').value = settings.hours.end; $('weekends').value = settings.hours.weekends ? 'yes' : 'no';
  $('bridgeUrl').value = settings.bridge.url; $('bridgeToken').value = settings.bridge.token;
  drawList('first'); drawList('followup');
}

function drawList(field) {
  const box = $(field), list = messages[field];
  box.replaceChildren(...list.map((v, i) => el('div', { className: 'ver' },
    el('div', { style: 'display:flex;gap:8px;align-items:center' }, el('b', {}, String.fromCharCode(65 + i)), el('input', { value: v.name, placeholder: 'Name, e.g. Feedback', oninput: (e) => { v.name = e.target.value; } }),
      el('button', { className: 'danger', onclick: () => { list.splice(i, 1); drawList(field); } }, 'Remove')),
    el('textarea', { value: v.text, placeholder: 'Hey {first_name}, ...', oninput: (e) => { v.text = e.target.value; } }))));
}
$('addFirst').onclick = () => { messages.first.push({ name: '', text: '' }); drawList('first'); };
$('addFollowup').onclick = () => { messages.followup.push({ name: '', text: '' }); drawList('followup'); };

function collect() {
  const num = (id, lo, hi, d) => { const n = Math.round(Number($(id).value)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    ...settings,
    firstName: $('firstName').value.trim(), calendarLink: $('calendarLink').value.trim(),
    searches: $('searches').value.split('\n').map((s) => s.trim()).filter(Boolean),
    followups: num('followups', 0, 2, 1), followupDays: num('followupDays', 1, 30, 4), messageDelayMinutes: num('messageDelayMinutes', 0, 1440, 5),
    searchPagesPerDay: num('searchPagesPerDay', 0, 30, 6),
    limits: { ...settings.limits, invite: num('invite', 1, 40, 20), message: num('message', 1, 80, 40) },
    hours: { start: num('start', 0, 23, 8), end: num('end', 1, 24, 19), weekends: $('weekends').value === 'yes' },
    bridge: { url: $('bridgeUrl').value.trim(), token: $('bridgeToken').value.trim() },
    messages: { first: messages.first.filter((m) => m.text.trim()), followup: messages.followup.filter((m) => m.text.trim()) },
  };
}

$('save').onclick = async () => {
  const next = collect();
  if (!next.firstName) { $('saved').textContent = 'Add your first name first.'; $('firstName').focus(); return; }
  await chrome.storage.local.set({ settings: next });
  settings = withDefaults(next);
  $('saved').textContent = 'Saved.';
  setTimeout(() => { $('saved').textContent = ''; }, 2500);
};

function results(state) {
  const sum = summary(state, settings);
  const rows = (list) => list.map((v) => el('tr', {}, el('td', {}, el('b', {}, v.name)), el('td', { className: 'small' }, v.text), el('td', {}, String(v.sent)), el('td', {}, String(v.replied)), el('td', {}, v.sent ? v.rate + '%' : '-')));
  const table = (title, list) => el('div', { style: 'margin-top:10px' }, el('b', {}, title), el('table', {}, el('thead', {}, el('tr', {}, ...['Version', 'Text', 'Sent', 'Replied', 'Reply rate'].map((h) => el('th', {}, h)))), el('tbody', {}, ...rows(list))));
  $('results').replaceChildren(
    el('div', {}, `${sum.found} found, ${sum.invited} invited, ${sum.accepted} accepted (${sum.acceptRate}%), ${sum.messaged} messaged, ${sum.replied} replied (${sum.replyRate}%).`),
    table('First message versions', sum.variants.first), table('Follow-up versions', sum.variants.followup),
    el('p', { className: 'small muted' }, 'Wait for about 30 sends per version before trusting a difference. Below that it is noise.'));
}

$('exportSettings').onclick = () => {
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ ...collect(), bridge: { url: '', token: '' }, agreed: undefined }, null, 2)], { type: 'application/json' })), download: 'warmreach-settings.json' }); a.click();
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async (e) => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    settings = withDefaults({ ...data, agreed: settings.agreed });
    messages = JSON.parse(JSON.stringify(settings.messages));
    fill();
    $('saved').textContent = 'Imported. Check it, then press Save.';
  } catch { $('saved').textContent = 'That file is not a settings file.'; }
};
$('csv').onclick = async () => {
  const { state } = await chrome.storage.local.get('state');
  const rows = peopleRows(state || newState());
  if (!rows.length) { $('saved').textContent = 'Nobody found yet.'; return; }
  const cols = Object.keys(rows[0]), esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  el('a', { href: URL.createObjectURL(new Blob([[cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')], { type: 'text/csv' })), download: `warmreach-people-${new Date().toISOString().slice(0, 10)}.csv` }).click();
};
$('importPeople').onclick = () => $('importPeopleFile').click();
$('importPeopleFile').onchange = async (e) => {
  const people = parsePeopleCsv(await e.target.files[0].text());
  if (!people.length) { $('saved').textContent = 'No people found. The file needs a name column and a linkedin.com/in/ address column.'; return; }
  const { state } = await chrome.storage.local.get('state');
  const next = state || newState(Date.now());
  const { added, known } = addPeople(next, people, Date.now());
  await chrome.storage.local.set({ state: next });
  $('saved').textContent = `Imported ${added} people (${known} were already there).`;
  results(next);
};
$('reset').onclick = async () => {
  if (!confirm('Delete everyone it found and all progress? Your settings stay.')) return;
  await chrome.runtime.sendMessage({ type: 'reset' });
  await load();
};
load();
void DEFAULT_MESSAGES;
