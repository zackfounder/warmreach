// A local HTTPS server that answers as www.linkedin.com, so a real Chrome driven by the extension never touches the real site.
// Playwright's own request routing does not see navigations the extension starts itself, so the name is remapped at the
// browser instead: --host-resolver-rules sends www.linkedin.com to this server and --ignore-certificate-errors accepts its cert.
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.js';

export async function startFakeLinkedIn() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'on-li-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=www.linkedin.com'], { stdio: 'ignore' });
  const hits = [];
  const server = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
    const u = new URL(req.url, 'https://www.linkedin.com');
    hits.push(u.pathname + u.search);
    const file = u.pathname.startsWith('/search/') ? 'search-results.html' : u.pathname === '/favicon.ico' ? null : 'li.html';
    if (!file) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(ROOT, 'test/fixtures', file)));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    hits,
    args: [`--host-resolver-rules=MAP www.linkedin.com 127.0.0.1:${port}`, '--ignore-certificate-errors'],
    close: () => server.close(),
  };
}
