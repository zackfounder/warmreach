# The local bridge

Optional and **off by default**. It lets another program on the same computer read what Open Outreach knows and hand it people and messages to send. Leave the address empty in the settings (Advanced) and the extension never sends anything anywhere except to LinkedIn.

The address must be `localhost`, `127.0.0.1` or `[::1]`. Anything else is refused.

## What the extension does

About once a minute, if an address is set:

1. `GET {address}/commands` and applies what it returns.
2. `POST {address}/snapshot` with everything below, including the results of the last commands.

Every request carries the header `x-open-outreach: 1` (a web page cannot send this without a preflight your program should refuse), and `authorization: Bearer <token>` if you set a token.

## `GET /commands`

```json
{ "commands": [
  { "id": "a1", "type": "add_people", "stage": "found", "people": [{ "name": "Ana Silva", "url": "https://www.linkedin.com/in/ana", "headline": "Founder", "company": "Brightpath" }] },
  { "id": "a2", "type": "send", "url": "https://www.linkedin.com/in/ana", "kind": "message", "text": "Hi Ana, ..." },
  { "id": "a3", "type": "pause" },
  { "id": "a4", "type": "resume" }
] }
```

- Every command needs a unique `id`. A command is applied once; repeating an id does nothing.
- `add_people`: adds people. `stage: "connected"` says they are already 1st-degree connections (so they can be messaged); anything else adds them to be invited.
- `send`: queues a message (`kind` is `message` or `followup`) to someone already in the list who has accepted. It is typed and sent on their profile. It follows the same daily limit, working hours, pacing and stops as everything else, and it is refused for people who are not connected.
- Text must be 1 to 1500 characters.

## `POST /snapshot`

```json
{
  "at": 1793000000000, "enabled": true, "status": "Done: message", "halt": null,
  "summary": { "found": 21, "invited": 5, "accepted": 2, "messaged": 2, "replied": 1, "today": { "invite": { "used": 3, "cap": 5 } } },
  "people": [{ "key": "linkedin.com/in/ana", "name": "Ana Silva", "first_name": "Ana", "company": "Brightpath", "url": "https://www.linkedin.com/in/ana", "stage": "messaged", "invited": 1793000000000, "connected": 1793000100000, "messaged": 1793000200000, "followups": 0, "replied": null, "reply": "", "first_message": "...", "thread": [] }],
  "queue": [{ "id": "a2", "key": "linkedin.com/in/ana", "kind": "message" }],
  "log": [{ "ts": 1793000000000, "ok": true, "detail": "Sent the first message to Ana Silva" }],
  "acks": [{ "id": "a1", "ok": true, "detail": "1 added, 0 already known" }],
  "outbox": [{ "id": "a2", "ok": true, "detail": "sent", "at": 1793000300000, "key": "linkedin.com/in/ana" }]
}
```

Stages: `found`, `invited`, `connected`, `messaged`, `replied`, `skipped`. Respond with any 2xx to acknowledge; the extension then clears `outbox`.

## A minimal program on the other side

```js
import http from 'node:http';
let commands = [];
http.createServer((req, res) => {
  if (req.headers['x-open-outreach'] !== '1') { res.writeHead(403); return res.end(); }
  res.setHeader('content-type', 'application/json');
  if (req.method === 'GET' && req.url === '/bridge/commands') return res.end(JSON.stringify({ commands }));
  let body = ''; req.on('data', (d) => (body += d));
  req.on('end', () => { const s = JSON.parse(body); const done = new Set([...(s.acks || []), ...(s.outbox || [])].map((x) => x.id)); commands = commands.filter((c) => !done.has(c.id)); console.log(s.summary); res.end('{"ok":true}'); });
}).listen(5151, '127.0.0.1');
```

Set the address to `http://127.0.0.1:5151/bridge`.
