import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStatement } from '../public/engine/pipeline.js';
import { toMarkdown, toCsv } from '../public/engine/report.js';

const NOW = new Date(Date.UTC(2026, 6, 12));

// 12 monthly charges running up to the month before NOW, so both series are
// still live. A fixture that stops months short would read as "stopped" and
// quietly test nothing.
const stamp = (i, day) => {
  const month = 6 + i;                     // start July 2025 (month index 6)
  const year = 2025 + Math.floor(month / 12);
  return `${year}-${String((month % 12) + 1).padStart(2, '0')}-${day}`;
};

const CSV = [
  'Date,Description,Amount',
  ...Array.from({ length: 12 }, (_, i) => `${stamp(i, '17')},NETFLIX.COM LOS GATOS CA,-17.99`),
  ...Array.from({ length: 12 }, (_, i) => `${stamp(i, '03')},SPOTIFY USA NEW YORK NY,-11.99`),
].join('\n');

function analyzed() {
  const result = analyzeStatement(CSV, { now: NOW });
  assert.equal(result.ok, true);
  return result;
}

test('the action plan groups by what the human decided, not by what the tool guessed', () => {
  const result = analyzed();
  const md = toMarkdown(result, { SPOTIFY: 'cancel' }, { now: NOW });

  assert.match(md, /^# Subscription action plan/);
  assert.match(md, /## Cancel these/);
  assert.match(md, /### Spotify — \$11\.99 monthly \(\$143\.88\/yr\)/);
  assert.match(md, /\*\*Cancelling what you marked saves:\*\* \$143\.88\/yr/);

  // Netflix was not marked, so it must not appear under "Cancel these".
  const cancelBlock = md.slice(md.indexOf('## Cancel these'), md.indexOf('## Keep'));
  assert.equal(cancelBlock.includes('Netflix'), false);
});

test('an unmarked plan claims no savings', () => {
  const md = toMarkdown(analyzed(), {}, { now: NOW });
  assert.equal(md.includes('Cancelling what you marked saves'), false);
  assert.equal(md.includes('## Cancel these'), false);
});

test('the CSV export carries the decision and the evidence for it', () => {
  const rows = toCsv(analyzed(), { NETFLIX: 'cancel' }).split('\n');
  assert.equal(
    rows[0],
    'merchant,category,decision,amount,cadence,annual_cost,charges_seen,first_seen,last_seen,next_expected,confidence,flags',
  );

  const netflix = rows.find((r) => r.startsWith('Netflix,'));
  const cells = netflix.split(',');
  assert.equal(cells[1], 'Streaming');
  assert.equal(cells[2], 'cancel');
  assert.equal(cells[3], '17.99');
  assert.equal(cells[5], '215.88');
  assert.equal(cells[6], '12');
  assert.equal(cells[7], '2025-07-17');
  assert.equal(cells[8], '2026-06-17');
});

test('CSV export neutralizes formula prefixes in untrusted text', () => {
  for (const value of ['=1+1', '+1+1', '-1+1', '@SUM(A1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1']) {
    const result = analyzed();
    const s = result.series[0];
    s.name = value;
    s.category = value;
    s.cadenceLabel = value;
    s.flags = [{ id: value }];
    const line = toCsv(result, { [s.key]: value });
    const expected = "'" + value;
    const escaped = /[",\r\n]/.test(expected) ? '"' + expected.replace(/"/g, '""') + '"' : expected;
    assert.ok(line.includes(escaped + ',' + escaped + ',' + escaped + ','), JSON.stringify(value));
    assert.ok(line.includes(',' + escaped + '\n'), 'flags must also be protected');
  }
});

test('CSV export quotes carriage returns and preserves ordinary numeric cells', () => {
  const result = analyzed();
  result.series[0].name = 'ACME\rBilling';
  const csv = toCsv(result);
  assert.ok(csv.includes('"ACME\rBilling",'));
  assert.ok(csv.includes(',17.99,Monthly,215.88,'));
});
