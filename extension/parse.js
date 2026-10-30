// Turns the text and links of a LinkedIn search page into a list of people.

export function normUrl(u) {
  if (!u) return '';
  try {
    const x = new URL(/^https?:/i.test(u) ? u : 'https://' + u);
    return (x.hostname.replace(/^www\./, '') + x.pathname).replace(/\/+$/, '').toLowerCase();
  } catch {
    return String(u).toLowerCase().trim();
  }
}

export function splitHeadline(h) {
  const m = (h || '').match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);
  return m ? { role: m[1].trim(), company: m[2].trim() } : { role: (h || '').trim(), company: '' };
}

const NOISE = /^(•|·)|^(1st|2nd|3rd\+?)$|^(Connect|Message|Follow|Pending|Following|InMail|More|Save|Send|Premium|Open to work|Hiring|Verified|Visit my website|See all)$|^View .*profile|mutual connection|^Status is|^Provides services|^Current:|^Past:|^Skills:|^Summary:|^\d[\d,.]*\+? (followers|connections|mutual)|^\d+(st|nd|rd|th)\b/i;
const DEGREE = /\s*[•·]\s*(1st|2nd|3rd\+?|Following)\b.*$/i;
const CREDS = /,?\s+(MBA|PMP|CPA|PhD|Ph\.D\.?|MD|CFA|CSM|CISSP|MSc|MA|MS|BSc|JD|Esq\.?|CEO|PHR|SHRM-?\w*)(,\s*\w+)*$/i;

export function cleanName(raw) {
  let n = String(raw || '').split('\n')[0]
    .replace(DEGREE, '')
    .replace(/^View\s+/i, '').replace(/[’']s\s+(graphic link|profile).*$/i, '')
    .replace(/\((he|she|they|him|her|them)\s*\/[^)]*\)/ig, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) n = n.replace(CREDS, '').trim();
  return n;
}

// text: the visible text of the page. links: [{ text, href }] for every profile link on it.
export function parseCapture({ text = '', links = [] }) {
  const seen = new Set();
  const people = [];
  const lines = text.split(/\r?\n/).map((l) => l.split(String.fromCharCode(160)).join(' ').trim()).filter(Boolean);
  const norm = lines.map((l) => cleanName(l));
  for (const lk of links) {
    if (!/linkedin\.com\/in\//i.test(lk.href || '')) continue;
    const key = normUrl(lk.href);
    if (seen.has(key)) continue;
    const name = cleanName(lk.text);
    if (name.length < 3 || /linkedin member|^premium|^try |^status is|^\d/i.test(name)) continue;
    seen.add(key);
    let headline = '', location = '';
    // The name is usually printed twice (hidden + visible); start after the last consecutive copy.
    let idx = norm.findIndex((l) => l === name);
    while (idx >= 0 && norm[idx + 1] === name) idx++;
    if (idx >= 0) {
      const next = [];
      for (let i = idx + 1; i < Math.min(lines.length, idx + 9) && next.length < 2; i++) {
        if (NOISE.test(lines[i]) || DEGREE.test(lines[i]) && !lines[i].replace(DEGREE, '').trim() || norm[i] === name) continue;
        // A new person's name (another captured link) means this card has ended.
        if (links.some((o) => o !== lk && cleanName(o.text) === norm[i] && norm[i].length > 2)) break;
        next.push(lines[i]);
      }
      [headline = '', location = ''] = next;
    }
    // "• 1st" / "• 2nd" / "• 3rd+" next to the name says how close they already are to you.
    const dm = (s) => String(s).match(/(?:^|[•·]\s*)(1st|2nd|3rd)\+?\s*$|[•·]\s*(1st|2nd|3rd)\b/i);
    let degree = 0;
    const near = idx >= 0 ? lines.slice(idx + 1, idx + 5) : [];
    for (const l of [String(lk.text || '').split('\n').slice(-1)[0], ...near]) { const m = dm(l); if (m) { degree = parseInt(m[1] || m[2], 10); break; } }
    const sp = splitHeadline(headline);
    people.push({ name, headline, role: sp.role, company: sp.company, url: lk.href.split('?')[0], location, ...(degree ? { degree } : {}) });
  }
  return people;
}

// A spreadsheet of people you already have (name and LinkedIn address are enough). Columns are matched by name.
export function parsePeopleCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  const col = (r, names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0 && r[i] && r[i].trim()) return r[i].trim(); } return ''; };
  const out = [];
  for (const r of rows.slice(1)) {
    const url = col(r, ['linkedinurl', 'url', 'profileurl', 'linkedin', 'profile']);
    const name = col(r, ['name', 'fullname']) || [col(r, ['firstname']), col(r, ['lastname'])].filter(Boolean).join(' ');
    if (!/linkedin\.com\/in\//i.test(url) || !name) continue;
    const conn = col(r, ['connection', 'degree']);
    out.push({ name, url: url.split('?')[0], headline: col(r, ['headline', 'title']), company: col(r, ['company']), location: col(r, ['location']), ...(/^1/.test(conn) ? { degree: 1 } : {}) });
  }
  return out;
}
