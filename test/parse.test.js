import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCapture, cleanName } from '../extension/parse.js';

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/capture-shapes.json', import.meta.url), 'utf8'));

// This extension reads ordinary /in/ profile links; the Sales Navigator and pasted-text shapes belong to other tools.
for (const f of fixtures.filter((x) => x.links.length && x.links.every((l) => /linkedin\.com\/in\//.test(l.href) || !/linkedin\.com/.test(l.href)) && !/sales navigator/i.test(x.name))) {
  test(`search page shape: ${f.name}`, () => {
    const got = parseCapture({ text: f.text, links: f.links });
    assert.equal(got.length, f.expect.length, `expected ${f.expect.length} people, got ${JSON.stringify(got.map((p) => p.name))}`);
    f.expect.forEach((want, i) => {
      for (const [k, v] of Object.entries(want)) assert.equal(got[i][k === 'linkedinUrl' ? 'url' : k], v, `${want.name}.${k}`);
    });
  });
}

test('cleanName strips pronouns, credentials, degree markers and emoji', () => {
  assert.equal(cleanName('Ana Silva (she/her), MBA 🚀'), 'Ana Silva');
  assert.equal(cleanName('Rachel Kim • 2nd'), 'Rachel Kim');
  assert.equal(cleanName('View Jonas Weber’s profile'), 'Jonas Weber');
});

test('the connection degree next to a name is read, so people you already know are not invited', () => {
  const links = [{ text: 'Ana Silva', href: 'https://www.linkedin.com/in/ana' }, { text: 'Ben Cole', href: 'https://www.linkedin.com/in/ben' }, { text: 'Cy Moon', href: 'https://www.linkedin.com/in/cy' }];
  const text = 'Ana Silva\nAna Silva\n• 1st\nFounder at Brightpath\nParis\nBen Cole\nBen Cole\n• 2nd\nFounder at Lattice\nBerlin\nCy Moon\nCy Moon\n• 3rd+\nIndie hacker\nLisbon';
  assert.deepEqual(parseCapture({ text, links }).map((p) => [p.name, p.degree]), [['Ana Silva', 1], ['Ben Cole', 2], ['Cy Moon', 3]]);
});

import { parsePeopleCsv } from '../extension/parse.js';
test('a spreadsheet of people is read by column name', () => {
  const csv = 'Name,LinkedIn URL,Company,Connection\n"Ana Silva",https://www.linkedin.com/in/ana?x=1,Brightpath,2nd\nBen Cole,https://www.linkedin.com/in/ben,,1st\nNo Url,,Acme,\nBad Link,https://example.com/x,,';
  const out = parsePeopleCsv(csv);
  assert.deepEqual(out.map((p) => [p.name, p.url, p.company, p.degree]), [['Ana Silva', 'https://www.linkedin.com/in/ana', 'Brightpath', undefined], ['Ben Cole', 'https://www.linkedin.com/in/ben', '', 1]]);
});
