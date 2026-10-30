import test from 'node:test';
import assert from 'node:assert/strict';
import { newState, withDefaults, nextWork, applyReport, addPeople, summary, peopleRows, caps, allowance, inWindow, fillTemplate, templateReady, pickTemplate, DAY } from '../extension/core.js';

// A Wednesday at 10:00 local time, inside the default working hours.
const T0 = new Date('2026-10-28T10:00:00').getTime();
const S = (patch = {}) => withDefaults({ firstName: 'Alex', messageDelayMinutes: 5, hours: { start: 0, end: 24, weekends: true }, ...patch });
const rand0 = () => 0;
const fresh = (now = T0) => ({ ...newState(now - 30 * DAY), installedAt: now - 30 * DAY });
const person = (state, n, patch = {}) => { const key = `linkedin.com/in/${n}`; state.people[key] = { key, name: `${n[0].toUpperCase()}${n.slice(1)} Test`, first: `${n[0].toUpperCase()}${n.slice(1)}`, url: `https://www.linkedin.com/in/${n}`, headline: '', company: '', stage: 'found', foundAt: T0, ...patch }; return key; };
const done = (state, settings, report, now = T0) => applyReport(state, settings, report, now, rand0);

test('templates fill in names and skip what a person does not have', () => {
  const s = S({ calendarLink: '' });
  assert.equal(fillTemplate('Hey {first_name}, how is {company}? {my_first_name}', { first: 'Ana', company: 'Brightpath' }, s), 'Hey Ana, how is Brightpath? Alex');
  assert.equal(templateReady('Hey {first_name} at {company}', { first: 'Ana', company: '' }, s), false);
  assert.equal(templateReady('Book {calendar_link}', { first: 'Ana' }, s), false, 'no booking link set');
  assert.equal(templateReady('I am {my_first_name}', { first: 'Ana' }, S({ firstName: '' })), false, 'no first name set');
  const list = [{ name: 'A', text: 'Hey {first_name} at {company}' }, { name: 'B', text: 'Hey {first_name}' }];
  assert.equal(pickTemplate(list, { first: 'Ana', company: '' }, s, {}, 'first').i, 1, 'the version that needs a company is skipped');
});

test('connection requests go out one at a time, oldest first, never to someone already connected', () => {
  const st = fresh(); const s = S(); st.lastCheck = { accepts: T0, replies: T0 };
  addPeople(st, [{ name: 'Old One', url: 'https://www.linkedin.com/in/old-one', degree: 2 }, { name: 'Known Pal', url: 'https://www.linkedin.com/in/known-pal', degree: 1 }], T0 - 1000);
  addPeople(st, [{ name: 'New One', url: 'https://www.linkedin.com/in/new-one', degree: 3 }], T0);
  assert.equal(st.people['linkedin.com/in/known-pal'].stage, 'skipped');
  const w = nextWork(st, s, T0);
  assert.equal(w.type, 'send'); assert.equal(w.kind, 'invite'); assert.equal(w.name, 'Old One');
  const after = done(st, s, { type: 'send', kind: 'invite', key: w.key, ok: true });
  assert.equal(after.people[w.key].stage, 'invited');
  assert.equal(nextWork(after, s, T0 + 60000).type, 'idle', 'it pauses like a person between actions');
  assert.equal(nextWork(after, s, after.nextActionAt + 1).name, 'New One');
});

test('the moment someone accepts they get the first message, then a follow-up if they stay quiet', () => {
  const st = fresh(); const s = S({ followups: 1, followupDays: 4 });
  const k = person(st, 'jonas', { stage: 'invited', invitedAt: T0 - DAY });
  st.lastCheck = { replies: T0 };
  let w = nextWork(st, s, T0);
  assert.equal(w.type, 'accepts');
  let a = done(st, s, { type: 'accepts', ok: true, urls: ['https://www.linkedin.com/in/jonas/?x=1'] });
  assert.equal(a.people[k].stage, 'connected');
  assert.equal(nextWork(a, s, T0 + 60000).type === 'send', false, 'a few minutes of waiting first (and the pause between actions)');
  const later = T0 + 6 * 60000 + 600000;
  w = nextWork(a, s, later);
  assert.equal(w.kind, 'message'); assert.equal(w.text, 'Thanks for connecting, Jonas! What are you working on at the moment?');
  a = done(a, s, { type: 'send', kind: 'message', key: k, ok: true, variant: w.variant, variantName: w.variantName, text: w.text }, later);
  assert.equal(a.people[k].stage, 'messaged');
  a.lastCheck = { accepts: later + 5 * DAY, replies: later + 5 * DAY };
  assert.notEqual(nextWork(a, s, later + 3 * DAY).kind, 'followup', 'too early');
  w = nextWork(a, s, later + 4 * DAY + 1);
  assert.equal(w.kind, 'followup'); assert.match(w.text, /no pressure at all/);
  a = done(a, s, { type: 'send', kind: 'followup', key: k, ok: true, variant: w.variant, variantName: w.variantName, text: w.text }, later + 4 * DAY + 1);
  a.lastCheck = { accepts: later + 20 * DAY, replies: later + 20 * DAY };
  assert.notEqual(nextWork(a, s, later + 9 * DAY).kind, 'followup', 'only as many follow-ups as you asked for');
});

test('a reply stops everything for that person', () => {
  const st = fresh(); const s = S();
  const k = person(st, 'rachel', { stage: 'messaged', messagedAt: T0 - 5 * DAY, name: 'Rachel Kim' });
  person(st, 'ana', { stage: 'messaged', messagedAt: T0 - 5 * DAY, name: 'Ana Silva' });
  const a = done(st, s, { type: 'replies', ok: true, threads: [{ name: 'Rachel Kim', snippet: 'Sounds great, tell me more' }, { name: 'Ana Silva', snippet: 'You: Hi Ana, a quick question' }, { name: 'Total Stranger', snippet: 'Buy now' }] });
  assert.equal(a.people[k].stage, 'replied'); assert.equal(a.people[k].reply, 'Sounds great, tell me more');
  assert.equal(a.people['linkedin.com/in/ana'].stage, 'messaged', 'our own last message is not a reply');
  a.nextActionAt = 0; a.lastCheck = { accepts: T0, replies: T0 };
  assert.notEqual(nextWork(a, s, T0 + 5 * DAY).name, 'Rachel Test', 'no follow-up to someone who answered');
  const again = done(a, s, { type: 'replies', ok: true, threads: [{ name: 'Rachel Kim', snippet: 'Sounds great, tell me more' }] });
  assert.equal(Object.values(again.people).filter((p) => p.repliedAt).length, 1);
});

test('versions go out in turn, skipping ones that cannot be filled in', () => {
  const st = fresh(); const s = withDefaults({ firstName: 'Alex', messageDelayMinutes: 0, messages: { first: [{ name: 'A', text: 'Hi {first_name}.' }, { name: 'B', text: 'Hi {first_name} at {company}.' }], followup: [] } });
  const a = person(st, 'a', { stage: 'connected', connectedAt: T0 - DAY, company: 'Acme' }), b = person(st, 'b', { stage: 'connected', connectedAt: T0 - DAY, company: '' }), c = person(st, 'c', { stage: 'connected', connectedAt: T0 - DAY, company: 'Lattice' });
  let cur = st; const got = [];
  for (let i = 0; i < 3; i++) { const w = nextWork(cur, s, T0 + i * DAY); got.push([w.name, w.variantName]); cur = done(cur, s, { type: 'send', kind: 'message', key: w.key, ok: true, variant: w.variant, variantName: w.variantName, text: w.text }, T0 + i * DAY); cur.lastCheck = { accepts: T0 + 9 * DAY, replies: T0 + 9 * DAY }; cur.nextActionAt = 0; }
  assert.deepEqual(got.map((g) => g[1]), ['A', 'A', 'B'], 'the second person has no company, so only A fits; the third gets the version used least');
  void a; void b; void c;
});

test('daily and weekly budgets, the warm-up, and working hours', () => {
  const s = S(); const st = fresh();
  assert.deepEqual(caps({ ...st, installedAt: T0 }, s, T0), { invite: 5, message: 10, inviteWeek: 22 }, 'day one is 25%');
  assert.equal(caps(st, s, T0).invite, 20, 'fully warmed up after two weeks');
  st.activity = Array.from({ length: 20 }, (_, i) => ({ ts: T0 - i * 1000, type: 'invite' }));
  assert.equal(allowance(st, s, 'invite', T0).ok, false);
  assert.equal(allowance(st, s, 'invite', T0 + DAY).ok, true, 'the next day it is allowed again');
  const weekly = fresh(); weekly.activity = Array.from({ length: 90 }, (_, i) => ({ ts: T0 - (i % 6) * DAY - 5000, type: 'invite' }));
  assert.match(allowance(weekly, s, 'invite', T0 + 1).reason, /Weekly/);
  const office = withDefaults({ firstName: 'Alex' }).hours;
  assert.equal(inWindow(new Date('2026-10-28T07:30:00').getTime(), office), false);
  assert.equal(inWindow(new Date('2026-10-28T10:30:00').getTime(), office), true);
  assert.equal(inWindow(new Date('2026-10-31T11:00:00').getTime(), office), false, 'Saturday');
  assert.equal(nextWork(fresh(), withDefaults({ firstName: 'Alex' }), new Date('2026-10-28T22:00:00').getTime()).type, 'idle');
});

test('anything scary stops everything; facts about one person are not failures', () => {
  const s = S(); let st = fresh(); const k = person(st, 'bob');
  st = done(st, s, { type: 'send', kind: 'invite', key: k, ok: false, code: 'restricted', detail: 'Unusual activity' });
  assert.equal(nextWork(st, s, T0 + DAY).type, 'halted'); assert.match(st.halt.reason, /restricted/);
  st = fresh(); const a = person(st, 'a'), b = person(st, 'b'), c = person(st, 'c'), d = person(st, 'd');
  st = done(st, s, { type: 'send', kind: 'invite', key: a, ok: false, code: 'pending' });
  st = done(st, s, { type: 'send', kind: 'invite', key: b, ok: false, code: 'already_connected' });
  assert.equal(st.halt, null); assert.equal(st.people[a].stage, 'invited'); assert.equal(st.people[b].stage, 'skipped');
  for (let i = 0; i < 2; i++) st = done(st, s, { type: 'send', kind: 'invite', key: c, ok: false, code: 'not_found' });
  assert.equal(st.halt, null); assert.equal(st.people[c].attempts, 2);
  assert.equal(nextWork({ ...st, nextActionAt: 0 }, s, T0).name === 'C Test', false, 'a person that failed twice is not retried forever');
  st = done(st, s, { type: 'send', kind: 'invite', key: d, ok: false, code: 'not_found' });
  assert.ok(st.halt, 'three failures in a row means LinkedIn probably changed');
  for (const code of ['limit', 'checkpoint', 'logged_out']) assert.ok(done(fresh(), s, { type: 'search', ok: false, code }).halt, code);
});

test('searching: pages through your searches, saves everyone, and stops at the daily budget or a backlog', () => {
  const s = S({ searches: ['solo founder', 'indie hacker'], pagesPerSearch: 2, searchPagesPerDay: 3, maxBacklog: 3 });
  let st = fresh();
  let w = nextWork(st, s, T0);
  assert.equal(w.type, 'search'); assert.match(w.url, /keywords=solo%20founder&.*network=%5B%22S%22%2C%22O%22%5D$/); assert.equal(w.page, 1);
  const found = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, url: `https://www.linkedin.com/in/p${i}-${Math.random()}`, ...extra }));
  st = done(st, s, { type: 'search', ok: true, query: w.query, people: found(1, { degree: 1 }) });
  st.nextActionAt = 0; w = nextWork(st, s, T0 + 1);
  assert.equal(w.page, 2); assert.match(w.url, /&page=2$/);
  st = done(st, s, { type: 'search', ok: true, query: w.query, people: [] }, T0 + 1); st.nextActionAt = 0;
  w = nextWork(st, s, T0 + 2);
  assert.equal(w.query, 'indie hacker'); assert.equal(w.page, 1, 'an empty page moves on to the next search');
  const big = fresh(); addPeople(big, found(4), T0);
  assert.notEqual(nextWork(big, s, T0).type, 'search', 'a backlog of people waiting pauses searching');
});

test('practice mode never records anything as sent and stops after five', () => {
  const s = S({ practice: true }); let st = fresh();
  const keys = Array.from({ length: 6 }, (_, i) => person(st, `p${i}`));
  let sent = 0;
  for (let i = 0; i < 8; i++) {
    st.nextActionAt = 0; const w = nextWork(st, s, T0 + i);
    if (w.type !== 'send') break;
    assert.equal(w.rehearsal, true);
    st = done(st, s, { type: 'send', kind: 'invite', key: w.key, ok: true, rehearsed: true }, T0 + i); sent++;
  }
  assert.equal(sent, 5); assert.equal(st.activity.length, 0); assert.ok(keys.every((k) => st.people[k].stage === 'found'));
});

test('summary and export', () => {
  const s = S(); const st = fresh();
  person(st, 'a', { stage: 'replied', invitedAt: 1, connectedAt: 2, messagedAt: 3, repliedAt: 4, variant: 0, variantName: 'Question' });
  person(st, 'b', { stage: 'messaged', invitedAt: 1, connectedAt: 2, messagedAt: 3, variant: 1, variantName: 'Feedback' });
  const sum = summary(st, s, T0);
  assert.deepEqual([sum.found, sum.invited, sum.accepted, sum.messaged, sum.replied, sum.acceptRate, sum.replyRate], [2, 2, 2, 2, 1, 100, 50]);
  assert.deepEqual(sum.variants.first.map((v) => [v.name, v.sent, v.replied, v.rate]), [['Question', 1, 1, 100], ['Feedback', 1, 0, 0], ['Meeting', 0, 0, 0]]);
  const rows = peopleRows(st);
  assert.equal(rows.length, 2); assert.ok(rows.every((r) => 'first_name' in r && 'linkedin_url' in r));
});

import { applyCommands, snapshot } from '../extension/core.js';

test('bridge: another program can add people and queue messages, and they still obey the limits', () => {
  const s = S(); let st = fresh();
  const added = applyCommands(st, [{ id: 'c1', type: 'add_people', stage: 'connected', people: [{ name: 'Rachel Kim', url: 'https://www.linkedin.com/in/rachel', company: 'Northwind' }, { name: '', url: 'x' }] }]);
  st = added.state;
  assert.deepEqual(added.acks, [{ id: 'c1', ok: true, detail: '1 added, 0 already known' }]);
  assert.equal(st.people['linkedin.com/in/rachel'].stage, 'connected');
  const q = applyCommands(st, [
    { id: 'c2', type: 'send', url: 'https://www.linkedin.com/in/rachel', text: 'Hi Rachel, quick question about Northwind.' },
    { id: 'c3', type: 'send', url: 'https://www.linkedin.com/in/nobody', text: 'hi' },
    { id: 'c4', type: 'send', url: 'https://www.linkedin.com/in/rachel', text: '' },
    { id: 'c5', type: 'frobnicate' },
    { id: 'c2', type: 'send', url: 'https://www.linkedin.com/in/rachel', text: 'duplicate id is ignored' },
  ]);
  st = q.state;
  assert.deepEqual(q.acks.map((a) => [a.id, a.ok]), [['c2', true], ['c3', false], ['c4', false], ['c5', false]]);
  assert.equal(st.queue.length, 1);
  st.lastCheck = { accepts: T0, replies: T0 };
  const w = nextWork(st, s, T0);
  assert.equal(w.type, 'send'); assert.equal(w.queueId, 'c2'); assert.equal(w.text, 'Hi Rachel, quick question about Northwind.');
  const after = done(st, s, { type: 'send', kind: 'message', key: w.key, ok: true, queueId: 'c2', text: w.text });
  assert.equal(after.queue.length, 0); assert.deepEqual(after.outbox.map((o) => [o.id, o.ok]), [['c2', true]]);
  assert.equal(after.people[w.key].thread[0].text, w.text); assert.equal(after.people[w.key].stage, 'messaged');
  assert.equal(after.activity.length, 1, 'it counts against the daily message budget');
  // not allowed to message someone who is not connected, and a full day's budget holds everything back
  const found = applyCommands(fresh(), [{ id: 'd1', type: 'add_people', people: [{ name: 'Far Away', url: 'https://www.linkedin.com/in/far' }] }]).state;
  assert.equal(applyCommands(found, [{ id: 'd2', type: 'send', url: 'https://www.linkedin.com/in/far', text: 'hi' }]).acks[0].ok, false);
  const busy = fresh(); busy.activity = Array.from({ length: 40 }, (_, i) => ({ ts: T0 - i, type: 'message' }));
  const queued = applyCommands(applyCommands(busy, [{ id: 'e1', type: 'add_people', stage: 'connected', people: [{ name: 'Rachel Kim', url: 'https://www.linkedin.com/in/rachel' }] }]).state, [{ id: 'e2', type: 'send', url: 'https://www.linkedin.com/in/rachel', text: 'hi' }]).state;
  assert.notEqual(nextWork(queued, s, T0).type, 'send', 'the daily limit still applies');
});

test('bridge: a failed queued message is reported back, and pause and resume work', () => {
  const s = S(); let st = applyCommands(fresh(), [{ id: 'a', type: 'add_people', stage: 'connected', people: [{ name: 'Rachel Kim', url: 'https://www.linkedin.com/in/rachel' }] }, { id: 'b', type: 'send', url: 'https://www.linkedin.com/in/rachel', text: 'hello' }]).state;
  st.lastCheck = { accepts: T0, replies: T0 };
  const w = nextWork(st, s, T0);
  st = done(st, s, { type: 'send', kind: 'message', key: w.key, ok: false, code: 'not_connected', queueId: 'b' });
  assert.equal(st.queue.length, 0); assert.equal(st.outbox[0].ok, false); assert.match(st.outbox[0].detail, /not_connected/);
  assert.equal(applyCommands({ ...st, enabled: true }, [{ id: 'p', type: 'pause' }]).state.enabled, false);
  assert.equal(applyCommands({ ...st, enabled: false }, [{ id: 'r', type: 'resume' }]).state.enabled, true);
  const snap = snapshot(st, s, T0);
  assert.equal(snap.people.length, 1); assert.ok('summary' in snap && 'log' in snap);
});
