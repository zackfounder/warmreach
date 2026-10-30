// The hands of Warmreach: what happens on a LinkedIn page when the background worker asks for it.
// Everything is found by visible text or aria-label, not by LinkedIn's generated class names, because those change weekly.
// Every action ends at the same place: one result object { ok, code, detail, ... }. Nothing here decides *whether* to act.
(function () {
  if (globalThis.__oo) return;
  const oo = (globalThis.__oo = {});
  let speed = 1; // 1 = human pace. Tests shrink it; nothing else does.

  const rand = (a, b) => a + Math.random() * (b - a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms * speed));
  const pause = (a = 400, b = 1100) => sleep(rand(a, b));
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const vis = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const txt = (el) => clean(el.innerText || el.textContent);
  const label = (el) => clean(el.getAttribute && el.getAttribute('aria-label'));
  const all = (sel, root = document) => [...root.querySelectorAll(sel)].filter(vis);
  // LinkedIn draws its pop-ups (invitation, post editor) inside a shadow root, which a normal query cannot see into.
  const deepAll = (sel, root = document) => {
    const out = [...root.querySelectorAll(sel)];
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...deepAll(sel, el.shadowRoot));
    return out;
  };
  const res = (re, s) => (Array.isArray(re) ? re : [re]).some((r) => r.test(s));
  const findBtn = (re, root = document, sel = 'button, a, [role="button"], [role="menuitem"], li[role="menuitem"]') =>
    all(sel, root).find((b) => res(re, txt(b)) || res(re, label(b))) || null;
  const waitFor = async (fn, ms = 8000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const v = fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 120));
    }
    return null;
  };
  const fail = (code, detail, extra = {}) => ({ ok: false, code, detail, ...extra });

  // The visible text of the page and every profile link on it, for the background worker to turn into people.
  function extractPage() {
    const links = [];
    for (const a of document.querySelectorAll('a[href*="/in/"]')) {
      const href = a.href.split('?')[0];
      let text = (a.innerText || '').split('\n').map(clean).filter(Boolean)[0] || clean(a.getAttribute('aria-label'));
      text = text.replace(/^View\s+/i, '').replace(/[’\']s\s+(graphic link|profile).*$/i, '');
      if (text) links.push({ text, href });
    }
    const selected = window.getSelection ? String(window.getSelection()) : '';
    return { text: (selected || document.body.innerText || '').slice(0, 80000), links: links.slice(0, 400), url: location.href, title: document.title };
  }


  // Things that mean "stop everything and let a person look".
  function pageProblem() {
    const u = location.pathname + location.search;
    if (/\/checkpoint\/|\/challenge\b/.test(u)) return { code: 'checkpoint', detail: 'LinkedIn is asking for a security check' };
    if (/^\/(login|uas\/login|authwall|signup)/.test(location.pathname)) return { code: 'logged_out', detail: 'You are not logged in to LinkedIn in this browser' };
    const t = ((document.body ? document.body.innerText : '') + ' ' + deepAll('[role="dialog"], [role="alertdialog"], .artdeco-modal').map((d) => d.textContent || '').join(' ')).slice(0, 12000);
    if (/weekly invitation limit|reached the (weekly )?invitation limit|you['’]ve reached the weekly/i.test(t)) return { code: 'limit', detail: 'Weekly invitation limit reached' };
    if (/account (has been )?(temporarily )?restricted|temporarily restricted|unusual activity|not a robot|security verification|verify (that )?you['’]re (a )?human/i.test(t)) return { code: 'restricted', detail: 'LinkedIn reports unusual activity or a restriction' };
    return null;
  }

  async function click(el) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    await pause(250, 700);
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await pause(80, 260);
    el.click();
    await pause(300, 800);
  }

  // Types like a person: short bursts at an uneven pace, the odd longer pause. Bursts rather than single letters so a
  // browser that slows background tabs to one timer tick a second still finishes a long post in a minute or two.
  async function typeInto(el, text) {
    el.focus();
    const put = (chunk) => {
      if (el.isContentEditable) {
        chunk.split('\n').forEach((line, i) => { if (i) document.execCommand('insertParagraph'); if (line) document.execCommand('insertText', false, line); });
      } else {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, el.value + chunk);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: chunk, inputType: 'insertText' }));
      }
    };
    for (let i = 0; i < text.length;) {
      const n = Math.floor(rand(3, 9));
      put(text.slice(i, i + n));
      i += n;
      await sleep(rand(120, 420));
      if (Math.random() < 0.06) await sleep(rand(500, 1400));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await pause(300, 800);
  }

  const mark = (el) => { el.style.outline = '3px solid #c8400a'; el.style.outlineOffset = '2px'; };
  const dialog = (match) => deepAll('[role="dialog"], .artdeco-modal').filter((d) => vis(d) && (!match || match.test(clean(d.textContent)))).slice(-1)[0] || null;
  // Closes whatever pop-up is open, and says "discard" if LinkedIn asks whether to keep what was typed.
  async function closeDialog() {
    const d = dialog();
    if (!d) return;
    const x = findBtn([/^dismiss$/i, /^close$/i], d); if (x) { x.click(); await pause(400, 900); }
    const confirm = await waitFor(() => findBtn([/^discard/i], document, 'button') || deepAll('button').filter(vis).find((b) => /^discard/i.test(txt(b))), 1500);
    if (confirm) { confirm.click(); await pause(300, 700); }
  }
  const mainEl = () => document.querySelector('main') || document.body;

  async function ready(what = 'the page') {
    const h = await waitFor(() => { const m = document.querySelector('main'); return m && txt(m).length > 40 ? m : null; }, 20000);
    if (!h) return pageProblem() || fail('not_found', `${what} did not load`);
    await pause(1200, 3000);
    return pageProblem();
  }

  // ---- actions ---------------------------------------------------------------------------------

  // Presses Connect and sends the invitation without a note. A practice run finds the button and stops: on some
  // profiles Connect sends the invitation at once, so practice never clicks it.
  async function sendInvite({ rehearse }) {
    const bad = await ready('the profile'); if (bad) return fail(bad.code, bad.detail);
    const main = mainEl();
    if (findBtn([/^pending\b/i], main)) return fail('pending', 'An invitation to this person is already pending');
    let connect = findBtn([/^connect$/i, /^invite .+ to connect/i], main);
    if (!connect) {
      const top = txt(main).slice(0, 800);
      if (/·\s*1st\b|\b1st\b/.test(top) && findBtn([/^message\b/i], main)) return fail('already_connected', 'Already a 1st-degree connection');
      const more = findBtn([/^more$/i, /^more actions$/i], main);
      if (more) {
        await click(more);
        connect = await waitFor(() => findBtn([/^connect$/i, /^invite .+ to connect/i], document, '[role="menuitem"], [role="menu"] *, .artdeco-dropdown__content *'), 3000);
      }
    }
    if (!connect) { if (rehearse) await closeDialog(); return fail('no_connect', 'There is no Connect option for this person (Follow-only, or outside your network)'); }
    if (rehearse) {
      mark(connect); connect.scrollIntoView({ block: 'center' }); await pause(1200, 2200);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { ok: true, rehearsed: true };
    }
    await click(connect);
    const INVITE = /invit|add a note|send without a note|connect/i;
    await waitFor(() => dialog(INVITE) || pageProblem(), 6000);
    const prob = pageProblem(); if (prob) return fail(prob.code, prob.detail);
    const dlg = dialog(INVITE);
    if (!dlg) {
      // Some profiles send the invitation the moment Connect is pressed.
      if (findBtn([/^pending\b/i], main)) return { ok: true };
      return fail('not_found', 'The invitation dialog did not open');
    }
    const send = findBtn([/^send without a note$/i, /^send( invitation| now)?$/i], dlg);
    if (!send) return fail('not_found', 'The Send button was not found');
    await click(send);
    await waitFor(() => !dialog(INVITE) || pageProblem(), 8000);
    const after = pageProblem(); if (after) return fail(after.code, after.detail);
    if (dialog(INVITE)) return fail('not_found', 'The dialog stayed open after Send');
    return { ok: true };
  }

  async function sendMessage({ text, rehearse }) {
    const bad = await ready('the profile'); if (bad) return fail(bad.code, bad.detail);
    const btn = findBtn([/^message\b/i], mainEl());
    if (!btn) return fail('not_connected', 'No Message button: not a 1st-degree connection yet');
    await click(btn);
    const box = await waitFor(() => all('[contenteditable="true"][role="textbox"], .msg-form__contenteditable').slice(-1)[0], 8000);
    if (!box) return fail('not_found', 'The message box did not open');
    await typeInto(box, text);
    const scope = box.closest('form') || box.closest('[role="dialog"]') || document;
    const send = findBtn([/^send$/i], scope, 'button');
    if (!send) return fail('not_found', 'The Send button was not found');
    if (rehearse) {
      mark(send); await pause(1200, 2200);
      const x = findBtn([/^close\b.*(conversation|chat)/i, /^close$/i], document, 'button');
      if (x) await click(x);
      return { ok: true, rehearsed: true };
    }
    await click(send);
    const sent = await waitFor(() => !clean(box.innerText), 8000);
    const after = pageProblem(); if (after) return fail(after.code, after.detail);
    return sent ? { ok: true } : fail('not_found', 'The message box was not cleared after Send');
  }

  async function readConnections() {
    const bad = await ready('your connections'); if (bad) return fail(bad.code, bad.detail);
    const first = await waitFor(() => document.querySelector('a[href*="/in/"]'), 15000);
    if (!first) return fail('not_found', 'No people found on the connections page');
    for (let i = 0; i < 2; i++) { window.scrollBy({ top: rand(500, 900), behavior: 'smooth' }); await pause(700, 1500); }
    const urls = [...new Set([...document.querySelectorAll('a[href*="/in/"]')].map((a) => a.href.split('?')[0]))].slice(0, 80);
    return { ok: true, urls };
  }

  async function readInbox() {
    const bad = await ready('the inbox'); if (bad) return fail(bad.code, bad.detail);
    const first = await waitFor(() => document.querySelector('a[href*="/messaging/thread/"]') || (/no messages|start a conversation/i.test(document.body.innerText) ? document.body : null), 15000);
    if (!first) return fail('not_found', 'The conversation list did not load');
    const seen = new Set();
    const threads = [];
    for (const a of document.querySelectorAll('a[href*="/messaging/thread/"]')) {
      const li = a.closest('li') || a.parentElement;
      if (!li || seen.has(li)) continue;
      seen.add(li);
      const lines = (li.innerText || '').split('\n').map(clean).filter(Boolean);
      if (lines.length < 2) continue;
      const name = lines[0];
      const snippet = lines.filter((l, i) => i > 0 && !/^(\d+\s?[smhdw]|now|yesterday|mon|tue|wed|thu|fri|sat|sun|[a-z]{3} \d{1,2})$/i.test(l)).slice(-1)[0] || '';
      threads.push({ name, snippet, unread: /unread/i.test(li.className + ' ' + label(li) + ' ' + li.innerHTML.slice(0, 400)) });
      if (threads.length >= 25) break;
    }
    return { ok: true, threads };
  }

  async function searchPage() {
    const bad = await ready('the search'); if (bad) return fail(bad.code, bad.detail);
    await waitFor(() => document.querySelector('a[href*="/in/"]') || /no results found/i.test(document.body.innerText), 15000);
    for (let i = 0, y = 0; i < 12 && y < document.documentElement.scrollHeight; i++) {
      y += rand(450, 850);
      window.scrollTo({ top: y, behavior: 'smooth' });
      await pause(500, 1400);
    }
    const none = /no results found/i.test(document.body.innerText);
    if (!document.querySelector('a[href*="/in/"]') && !none) return fail('not_found', 'The search page showed neither people nor "No results"');
    const payload = extractPage();
    return { ok: true, payload };
  }

  const actions = { sendInvite, sendMessage, readConnections, readInbox, searchPage };
  oo.run = async (action, params = {}) => {
    try {
      if (!actions[action]) return fail('unknown', `Unknown action ${action}`);
      const pre = pageProblem();
      if (pre) return fail(pre.code, pre.detail);
      const r = await actions[action](params);
      if (!r.ok) await closeDialog().catch(() => {});
      return r;
    } catch (e) {
      await closeDialog().catch(() => {});
      return fail('error', String((e && e.message) || e));
    }
  };

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (!msg || msg.type !== 'oo-run') return false;
      speed = typeof msg.speed === 'number' ? msg.speed : 1;
      oo.run(msg.action, msg.params).then(reply);
      return true;
    });
  }
})();
