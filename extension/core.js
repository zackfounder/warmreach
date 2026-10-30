// All the decisions, with no browser in them: who to invite, who to message, when to follow up, how much per day.
// The background worker only carries them out. Every function takes the state in and gives the new state back,
// so all of it can be tested in plain Node.
import { normUrl } from './parse.js';

export const DAY = 864e5;
const dkey = (t) => new Date(t).toLocaleDateString('en-CA');
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------- settings and messages
export const DEFAULT_MESSAGES = {
  first: [
    { name: 'Question', text: 'Thanks for connecting, {first_name}! What are you working on at the moment?' },
    { name: 'Feedback', text: "Thanks for connecting, {first_name}. I'm {my_first_name} and I'm building something for founders. Would you be open to giving me honest feedback on it?" },
    { name: 'Meeting', text: "Thanks for connecting, {first_name}. Would you be up for a quick 15 min chat this week? I'd love to hear how you work." },
  ],
  followup: [
    { name: 'Nudge', text: 'Hey {first_name}, no pressure at all. Just checking you saw my message. Happy to keep it short.' },
  ],
};

export const DEFAULT_SETTINGS = {
  firstName: '',
  calendarLink: '',
  searches: ['solo founder', 'indie hacker'],
  pagesPerSearch: 3,
  searchPagesPerDay: 6,
  maxBacklog: 30,
  hours: { start: 8, end: 19, weekends: false },
  limits: { invite: 20, message: 40, inviteWeek: 90 },
  messageDelayMinutes: 5,
  followups: 1,
  followupDays: 4,
  checkEveryMinutes: 20,
  practice: false,
  bridge: { url: '', token: '' },
  messages: DEFAULT_MESSAGES,
};

export function withDefaults(s = {}) {
  return {
    ...DEFAULT_SETTINGS, ...s,
    hours: { ...DEFAULT_SETTINGS.hours, ...(s.hours || {}) },
    limits: { ...DEFAULT_SETTINGS.limits, ...(s.limits || {}) },
    bridge: { ...DEFAULT_SETTINGS.bridge, ...(s.bridge || {}) },
    messages: { first: s.messages?.first ?? DEFAULT_MESSAGES.first, followup: s.messages?.followup ?? DEFAULT_MESSAGES.followup },
  };
}

export function newState(now = Date.now()) {
  return { v: 1, installedAt: now, enabled: false, people: {}, activity: [], counts: {}, cursor: { i: 0, page: 1 }, lastCheck: {}, nextActionAt: 0, halt: null, failures: 0, log: [], queue: [], outbox: [], seenCommands: [] };
}

const FILLS = {
  first_name: (p) => p.first || '',
  company: (p) => p.company || '',
  my_first_name: (p, s) => (s.firstName || '').trim().split(/\s+/)[0] || '',
  calendar_link: (p, s) => (s.calendarLink || '').trim(),
};
export const templateNeeds = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
export const templateReady = (text, person, settings) => templateNeeds(text).every((k) => FILLS[k] && FILLS[k](person, settings));
export const fillTemplate = (text, person, settings) => String(text).replace(/\{(\w+)\}/g, (_, k) => (FILLS[k] ? FILLS[k](person, settings) : '')).replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();

export const firstNameOf = (n) => String(n || '').replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '').trim().split(/\s+/)[0] || '';

// ---------------------------------------------------------------- the daily budget
export function warmFactor(state, now) {
  const days = Math.max(0, (now - (state.installedAt || now)) / DAY);
  return Math.min(1, 0.25 + 0.75 * (days / 14));
}
export function caps(state, settings, now) {
  const f = warmFactor(state, now), l = settings.limits;
  return { invite: Math.max(3, Math.floor(l.invite * f)), message: Math.max(5, Math.floor(l.message * f)), inviteWeek: Math.max(10, Math.floor(l.inviteWeek * f)) };
}
export function inWindow(now, hours) {
  const d = new Date(now), day = d.getDay();
  if (!hours.weekends && (day === 0 || day === 6)) return false;
  const h = d.getHours() + d.getMinutes() / 60;
  return h >= hours.start && h < hours.end;
}
export function nextWindowStart(now, hours) {
  if (inWindow(now, hours)) return now;
  let t = Math.floor(now / 60000) * 60000;
  for (let i = 0; i < 8 * 24 * 60; i++) { if (inWindow(t, hours)) return t; t += 60000; }
  return now;
}
const countOf = (state, type, now, within) => state.activity.filter((a) => a.type === type && (within ? now - a.ts < within : dkey(a.ts) === dkey(now))).length;
export function allowance(state, settings, type, now) {
  const c = caps(state, settings, now);
  const used = countOf(state, type, now);
  if (type === 'invite' && countOf(state, 'invite', now, 7 * DAY) >= c.inviteWeek) return { ok: false, reason: 'Weekly invitation budget used' };
  if (used >= c[type]) return { ok: false, reason: `Today's ${type === 'invite' ? 'invitation' : 'message'} budget is used (${used}/${c[type]})` };
  return { ok: true, used, cap: c[type] };
}

// ---------------------------------------------------------------- what to do next
const searchUrl = (q, page) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}&origin=GLOBAL_SEARCH_HEADER&network=%5B%22S%22%2C%22O%22%5D${page > 1 ? `&page=${page}` : ''}`;
const today = (state, now) => (state.counts.date === dkey(now) ? state.counts : { date: dkey(now), search: 0, practiced: 0 });

// Picks the version of a message that has been used least so far, among those that can be filled in for this person.
export function pickTemplate(list, person, settings, people, field) {
  const ok = list.map((t, i) => ({ t, i })).filter(({ t }) => t.text && t.text.trim() && templateReady(t.text, person, settings));
  if (!ok.length) return null;
  const used = (i) => Object.values(people).reduce((n, p) => n + (field === 'followup' ? (p.followups || []).filter((f) => f.v === i).length : p.variant === i ? 1 : 0), 0);
  return ok.sort((a, b) => used(a.i) - used(b.i) || a.i - b.i)[0];
}

export function nextWork(state, settings, now = Date.now()) {
  const idle = (reason, nextAt) => ({ type: 'idle', reason, nextAt: nextAt || now + 5 * 60000 });
  if (state.halt) return { type: 'halted', halt: state.halt };
  if (!inWindow(now, settings.hours)) return idle('Outside your working hours', nextWindowStart(now, settings.hours));
  if (now < (state.nextActionAt || 0)) return idle('Pausing between actions like a person would', state.nextActionAt);
  const t = today(state, now);
  const practice = settings.practice;
  if (practice && t.practiced >= 5) return idle('Practice limit reached. Turn practice off to send for real.');
  const people = Object.values(state.people);
  const skipPracticed = (p) => !(practice && p.practicedAt && now - p.practicedAt < DAY);
  const send = (kind, p, extra = {}) => ({ type: 'send', kind, key: p.key, url: p.url, name: p.name, rehearsal: practice, ...extra });
  let soonest = null;
  const wait = (a) => { if (a.nextAt) soonest = Math.min(soonest ?? Infinity, a.nextAt); };

  // 0. Messages another program on this computer asked for, in the order it asked.
  const msgAllow = allowance(state, settings, 'message', now);
  if (msgAllow.ok) {
    for (const q of state.queue || []) {
      const p = state.people[q.key];
      if (p && (q.attempts || 0) < 2) return { type: 'send', kind: q.kind, key: p.key, url: p.url, name: p.name, text: q.text, queueId: q.id, rehearsal: practice };
    }
  } else if ((state.queue || []).length) wait(msgAllow);

  // 1. People who accepted get their first message.
  const msgOk = allowance(state, settings, 'message', now);
  if (msgOk.ok) {
    for (const p of people.filter((x) => x.stage === 'connected' && !x.messagedAt && now - (x.connectedAt || 0) >= settings.messageDelayMinutes * 60000 && (x.attempts || 0) < 2 && skipPracticed(x))) {
      const pick = pickTemplate(settings.messages.first, p, settings, state.people, 'first');
      if (pick) return send('message', p, { text: fillTemplate(pick.t.text, p, settings), variant: pick.i, variantName: pick.t.name });
    }
    // 2. A follow-up for people who have not answered, a few days after the last message.
    for (const p of people.filter((x) => (x.stage === 'messaged') && !x.repliedAt && (x.followups || []).length < settings.followups && now - Math.max(x.messagedAt || 0, ...(x.followups || []).map((f) => f.at)) >= settings.followupDays * DAY && (x.attempts || 0) < 2 && skipPracticed(x))) {
      const pick = pickTemplate(settings.messages.followup, p, settings, state.people, 'followup');
      if (pick) return send('followup', p, { text: fillTemplate(pick.t.text, p, settings), variant: pick.i, variantName: pick.t.name });
    }
  } else wait(msgOk);

  // 3. Who accepted, who replied.
  const every = settings.checkEveryMinutes * 60000;
  if (people.some((p) => p.stage === 'invited') && now - (state.lastCheck.accepts || 0) > every) return { type: 'accepts' };
  if (people.some((p) => ['invited', 'connected', 'messaged'].includes(p.stage)) && now - (state.lastCheck.replies || 0) > every) return { type: 'replies' };

  // 4. New invitations, without a note.
  const invOk = allowance(state, settings, 'invite', now);
  if (invOk.ok) {
    const p = people.filter((x) => x.stage === 'found' && (x.attempts || 0) < 2 && skipPracticed(x)).sort((a, b) => a.foundAt - b.foundAt)[0];
    if (p) return send('invite', p);
  } else wait(invOk);

  // 5. Find more people, unless there are plenty waiting.
  const backlog = people.filter((p) => p.stage === 'found').length;
  if (settings.searches.length && t.search < settings.searchPagesPerDay && backlog < settings.maxBacklog) {
    const cur = state.cursor, q = settings.searches[cur.i % settings.searches.length];
    return { type: 'search', query: q, page: cur.page, url: searchUrl(q, cur.page) };
  }
  return idle(soonest ? 'Waiting for the daily budget' : 'Nothing to do right now', soonest || undefined);
}

// ---------------------------------------------------------------- what happened
const HALT_CODES = new Set(['restricted', 'limit', 'checkpoint', 'logged_out']);
const PERSON_CODES = new Set(['pending', 'already_connected', 'no_connect', 'not_connected']);

export function addPeople(state, items, now) {
  let added = 0, known = 0;
  for (const it of items) {
    const key = normUrl(it.url);
    if (!key) continue;
    if (state.people[key]) { known++; continue; }
    state.people[key] = {
      key, name: it.name, first: firstNameOf(it.name), headline: it.headline || '', company: it.company || '', location: it.location || '', url: it.url,
      degree: it.degree || null, stage: it.degree === 1 ? 'skipped' : 'found', ...(it.degree === 1 ? { skipReason: 'already connected' } : {}), foundAt: now,
    };
    added++;
  }
  return { added, known };
}

const logAdd = (state, ts, ok, detail) => { state.log = [...state.log.slice(-79), { ts, ok, detail }]; };

function problem(state, now, code, detail, what) {
  state.failures = PERSON_CODES.has(code) ? state.failures : state.failures + 1;
  if (HALT_CODES.has(code)) state.halt = { code, at: now, reason: `LinkedIn showed "${code}": ${detail || ''}`.trim() };
  else if (state.failures >= 3) state.halt = { code, at: now, reason: `Three steps in a row failed (${code}${detail ? ': ' + detail : ''}). LinkedIn's page may have changed.` };
  logAdd(state, now, false, `${what}: ${detail || code}`);
}

export function applyReport(prev, settings, r, now = Date.now(), rand = Math.random) {
  const state = clone(prev);
  const pace = (ms) => { state.nextActionAt = now + ms; };
  const gap = (a, b) => Math.round((a + rand() * (b - a)) * 60000);
  const t = { ...today(state, now) };
  const p = r.key ? state.people[r.key] : null;

  if (r.type === 'send') {
    if (!p) return state;
    const what = `${r.kind} to ${p.name}`;
    const q = r.queueId ? (state.queue || []).find((x) => x.id === r.queueId) : null;
    const drop = (ok, detail) => { state.queue = state.queue.filter((x) => x.id !== r.queueId); state.outbox = [...(state.outbox || []).slice(-99), { id: r.queueId, key: r.key, ok, detail, at: now }]; };
    if (q && r.ok && !r.rehearsed) {
      state.failures = 0;
      state.activity = [...state.activity.filter((a) => now - a.ts < 8 * DAY), { ts: now, type: 'message' }];
      p.thread = [...(p.thread || []), { at: now, kind: q.kind, text: q.text, via: 'bridge' }];
      if (!p.messagedAt) { p.messagedAt = now; if (p.stage === 'connected') p.stage = 'messaged'; }
      drop(true, 'sent');
      logAdd(state, now, true, `Sent a message to ${p.name} (asked for by another program)`);
      pace(gap(3, 9));
      return state;
    }
    if (q && !r.ok) {
      const code = r.code || 'unknown';
      q.attempts = (q.attempts || 0) + 1;
      if (PERSON_CODES.has(code) || q.attempts >= 2) drop(false, `${code}${r.detail ? ': ' + r.detail : ''}`);
      problem(state, now, code, r.detail, what);
      pace(gap(1, 3));
      return state;
    }
    if (r.ok) {
      state.failures = 0;
      if (r.rehearsed) { p.practicedAt = now; t.practiced += 1; state.counts = t; logAdd(state, now, true, `Practised ${what} (nothing sent)`); pace(gap(1, 2)); return state; }
      state.activity = [...state.activity.filter((a) => now - a.ts < 8 * DAY), { ts: now, type: r.kind === 'invite' ? 'invite' : 'message' }];
      p.attempts = 0;
      if (r.kind === 'invite') { p.stage = 'invited'; p.invitedAt = now; }
      else if (r.kind === 'message') { p.stage = 'messaged'; p.messagedAt = now; p.variant = r.variant; p.variantName = r.variantName; p.text = r.text; }
      else { p.followups = [...(p.followups || []), { at: now, v: r.variant, name: r.variantName, text: r.text }]; }
      logAdd(state, now, true, `Sent ${r.kind === 'invite' ? 'a connection request' : r.kind === 'message' ? 'the first message' : 'a follow-up'} to ${p.name}`);
      pace(gap(3, 9));
      return state;
    }
    const code = r.code || 'unknown';
    if (code === 'already_connected') { p.stage = 'skipped'; p.skipReason = 'already connected'; }
    else if (code === 'pending') { p.stage = 'invited'; p.invitedAt = p.invitedAt || now; }
    else if (code === 'not_connected') { p.stage = 'invited'; p.attempts = 0; }
    else if (code === 'no_connect') { p.stage = 'skipped'; p.skipReason = 'no Connect option'; }
    else p.attempts = (p.attempts || 0) + 1;
    problem(state, now, code, r.detail, what);
    pace(gap(1, 3));
    return state;
  }

  if (r.type === 'search') {
    if (!r.ok) { problem(state, now, r.code || 'unknown', r.detail, `Search "${r.query}"`); pace(gap(1, 3)); return state; }
    state.failures = 0;
    const { added, known } = addPeople(state, r.people || [], now);
    const cur = state.cursor;
    state.cursor = !(r.people || []).length || cur.page >= settings.pagesPerSearch ? { i: cur.i + 1, page: 1 } : { i: cur.i, page: cur.page + 1 };
    t.search += 1; state.counts = t;
    logAdd(state, now, true, `Search "${r.query}" page ${cur.page}: ${(r.people || []).length} people, ${added} new${known ? `, ${known} already known` : ''}`);
    pace(gap(1, 3));
    return state;
  }

  if (r.type === 'accepts') {
    if (!r.ok) { problem(state, now, r.code || 'unknown', r.detail, 'Checking connections'); pace(gap(1, 3)); return state; }
    state.failures = 0;
    const seen = new Set((r.urls || []).map(normUrl));
    let n = 0;
    for (const x of Object.values(state.people)) if (x.stage === 'invited' && seen.has(x.key)) { x.stage = 'connected'; x.connectedAt = now; n++; }
    state.lastCheck = { ...state.lastCheck, accepts: now };
    logAdd(state, now, true, `Checked connections: ${n} accepted`);
    pace(gap(1, 3));
    return state;
  }

  if (r.type === 'replies') {
    if (!r.ok) { problem(state, now, r.code || 'unknown', r.detail, 'Checking messages'); pace(gap(1, 3)); return state; }
    state.failures = 0;
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    let n = 0;
    for (const th of r.threads || []) {
      const snippet = String(th.snippet || '').trim();
      if (!snippet || /^you:/i.test(snippet)) continue; // the last message is ours
      const hits = Object.values(state.people).filter((x) => norm(x.name) === norm(th.name) && ['invited', 'connected', 'messaged'].includes(x.stage));
      if (hits.length !== 1 || hits[0].lastSnippet === snippet) continue;
      const x = hits[0];
      x.lastSnippet = snippet; x.reply = snippet; x.repliedAt = now; x.stage = 'replied';
      if (!x.connectedAt) x.connectedAt = now;
      n++;
    }
    state.lastCheck = { ...state.lastCheck, replies: now };
    logAdd(state, now, true, `Checked messages: ${n} new repl${n === 1 ? 'y' : 'ies'}`);
    pace(gap(1, 3));
    return state;
  }
  return state;
}

// ---------------------------------------------------------------- what to show
export function summary(state, settings, now = Date.now()) {
  const ps = Object.values(state.people);
  const n = (f) => ps.filter(f).length;
  const c = caps(state, settings, now);
  const usedI = countOf(state, 'invite', now), usedM = countOf(state, 'message', now);
  const rate = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const variants = (list, sent, replied) => list.map((tpl, i) => { const s = ps.filter((p) => sent(p, i)); return { name: tpl.name || String.fromCharCode(65 + i), sent: s.length, replied: s.filter(replied).length, rate: rate(s.filter(replied).length, s.length), text: tpl.text }; });
  return {
    found: ps.length, waiting: n((p) => p.stage === 'found'), invited: n((p) => p.invitedAt), accepted: n((p) => p.connectedAt && p.invitedAt), messaged: n((p) => p.messagedAt),
    replied: n((p) => p.repliedAt), skipped: n((p) => p.stage === 'skipped'),
    acceptRate: rate(n((p) => p.connectedAt && p.invitedAt), n((p) => p.invitedAt)), replyRate: rate(n((p) => p.repliedAt), n((p) => p.messagedAt)),
    today: { invite: { used: usedI, cap: c.invite }, message: { used: usedM, cap: c.message }, search: { used: today(state, now).search, cap: settings.searchPagesPerDay } },
    variants: { first: variants(settings.messages.first, (p, i) => p.messagedAt && p.variant === i, (p) => p.repliedAt), followup: variants(settings.messages.followup, (p, i) => (p.followups || []).some((f) => f.v === i), (p) => p.repliedAt) },
  };
}

export function peopleRows(state) {
  const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '');
  return Object.values(state.people).sort((a, b) => b.foundAt - a.foundAt).map((p) => ({
    name: p.name, first_name: p.first, headline: p.headline, company: p.company, location: p.location, linkedin_url: p.url,
    connection: p.degree ? ({ 1: '1st', 2: '2nd', 3: '3rd+' }[p.degree] || '') : '', stage: p.stage, found: day(p.foundAt), invited: day(p.invitedAt), accepted: day(p.connectedAt),
    first_message: day(p.messagedAt), first_message_version: p.variantName || '', follow_ups: (p.followups || []).length, replied: day(p.repliedAt), reply: p.reply || '', skipped_because: p.skipReason || '',
  }));
}

// ---------------------------------------------------------------- an optional local bridge
// Another program on this computer can hand over people and messages to send, and read what is happening.
// Everything it asks for still goes through the same limits, hours, pacing and stops. See docs/BRIDGE.md.
const MAX_TEXT = 1500;
export function applyCommands(prev, commands, now = Date.now()) {
  const state = clone(prev);
  state.queue = state.queue || []; state.seenCommands = state.seenCommands || [];
  const acks = [];
  for (const c of (Array.isArray(commands) ? commands : []).slice(0, 50)) {
    const id = String(c?.id ?? '');
    if (!id) continue;
    if (state.seenCommands.includes(id)) continue;
    state.seenCommands = [...state.seenCommands.slice(-199), id];
    const ack = (ok, detail) => acks.push({ id, ok, detail });
    if (c.type === 'add_people') {
      const stage = c.stage === 'connected' ? 'connected' : 'found';
      const items = (Array.isArray(c.people) ? c.people : []).filter((x) => x && x.name && x.url).slice(0, 200).map((x) => ({ name: String(x.name), url: String(x.url), headline: String(x.headline || ''), company: String(x.company || ''), degree: stage === 'connected' ? 1 : x.degree }));
      const before = new Set(Object.keys(state.people));
      const { added, known } = addPeople(state, items, now);
      for (const it of items) { const p = state.people[normUrl(it.url)]; if (p && !before.has(p.key) && stage === 'connected') { p.stage = 'connected'; p.connectedAt = now; delete p.skipReason; } }
      ack(true, `${added} added, ${known} already known`);
    } else if (c.type === 'send') {
      const key = normUrl(c.url || '') || String(c.key || '');
      const p = state.people[key];
      const kind = c.kind === 'followup' ? 'followup' : 'message';
      const text = String(c.text || '').trim();
      if (!p) ack(false, 'unknown person: add them first with add_people');
      else if (!text || text.length > MAX_TEXT) ack(false, `text must be 1 to ${MAX_TEXT} characters`);
      else if (p.stage === 'skipped' || p.stage === 'found') ack(false, `${p.name} is not connected yet (stage: ${p.stage}), so they cannot be messaged`);
      else { state.queue.push({ id, key: p.key, kind, text, addedAt: now }); ack(true, 'queued'); }
    } else if (c.type === 'pause') { state.enabled = false; state.status = 'Paused by another program'; ack(true, 'paused'); }
    else if (c.type === 'resume') { state.enabled = true; ack(true, 'resumed'); }
    else ack(false, 'unknown command');
  }
  return { state, acks };
}

// What another program may read: enough to know everything, nothing it could use to log in as you (there is nothing like that here).
export function snapshot(state, settings, now = Date.now()) {
  return {
    at: now, enabled: !!state.enabled, status: state.status || '', halt: state.halt || null,
    summary: summary(state, settings, now),
    people: Object.values(state.people).map((p) => ({ key: p.key, name: p.name, first_name: p.first, headline: p.headline, company: p.company, url: p.url, stage: p.stage, found: p.foundAt, invited: p.invitedAt || null, connected: p.connectedAt || null, messaged: p.messagedAt || null, followups: (p.followups || []).length, replied: p.repliedAt || null, reply: p.reply || '', first_message: p.text || '', thread: p.thread || [], skipped: p.skipReason || '' })),
    queue: (state.queue || []).map((q) => ({ id: q.id, key: q.key, kind: q.kind })),
    log: (state.log || []).slice(-30),
  };
}
