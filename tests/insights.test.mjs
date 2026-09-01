import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMerchant } from '../public/engine/merchant.js';
import { detectRecurring } from '../public/engine/recurrence.js';
import { analyze, projectedSavings } from '../public/engine/insights.js';

const NOW = new Date(Date.UTC(2026, 6, 12));
const DAY = 86400000;

function build(specs) {
  const txns = [];
  for (const { description, charges, start = Date.UTC(2025, 6, 12) } of specs) {
    for (const [offset, amount] of charges) {
      txns.push({
        date: new Date(start + offset * DAY),
        description,
        amount,
        merchant: normalizeMerchant(description),
      });
    }
  }
  const { series } = detectRecurring(txns, { now: NOW });
  return analyze(series, { now: NOW });
}

const monthly = (count, amountAt, from = 0) =>
  Array.from({ length: count }, (_, i) => [from + i * 30, typeof amountAt === 'function' ? amountAt(i) : amountAt]);

const flagIds = (s) => s.flags.map((f) => f.id);

test('a price rise is reported with what it now costs per year', () => {
  const { series } = build([
    { description: 'NETFLIX.COM LOS GATOS CA', charges: monthly(12, (i) => (i < 6 ? 9.99 : 12.99)) },
  ]);
  const netflix = series[0];
  const flag = netflix.flags.find((f) => f.id === 'price_increase');
  assert.ok(flag, `expected a price_increase flag, got ${flagIds(netflix)}`);
  assert.equal(flag.label, 'Price up 30%');
  assert.match(flag.detail, /\$36\.00\/yr more/);   // (12.99 - 9.99) * 12
  assert.equal(netflix.verdict, 'review');
});

test('a promo that ended is called out as a converted trial', () => {
  const { series } = build([
    { description: 'NOTION LABS INC SAN FRANCISCO CA', charges: monthly(12, (i) => (i < 3 ? 3.99 : 10.0)) },
  ]);
  assert.ok(flagIds(series[0]).includes('trial_converted'));
});

test('an annual renewal inside the window is a warning; one outside it is not', () => {
  const soon = build([
    // Last charged 2025-08-14 -> next 2026-08-14, 33 days after NOW.
    { description: 'ADOBE INC', charges: [[0, 239.88], [365, 263.88]], start: Date.UTC(2024, 7, 14) },
  ]);
  const adobe = soon.series[0];
  const flag = adobe.flags.find((f) => f.id === 'renews_soon');
  assert.ok(flag, `expected renews_soon, got ${flagIds(adobe)}`);
  assert.equal(flag.label, 'Renews in 33 days');

  const later = build([
    // Next charge 2026-09-02: 52 days out, past the 45-day window.
    { description: 'AMAZON PRIME MEMBERSHIP', charges: [[0, 139], [365, 139]], start: Date.UTC(2024, 8, 2) },
  ]);
  assert.equal(flagIds(later.series[0]).includes('renews_soon'), false);
});

test('overlapping services are flagged; a phone plan plus home internet is not', () => {
  const { series } = build([
    { description: 'NETFLIX.COM', charges: monthly(12, 17.99) },
    { description: 'HULU', charges: monthly(12, 17.99) },
    { description: 'VERIZON WIRELESS PAYMENTS', charges: monthly(12, 89.99) },
    { description: 'COMCAST XFINITY', charges: monthly(12, 79.99) },
  ]);
  const netflix = series.find((s) => s.name === 'Netflix');
  const verizon = series.find((s) => s.name === 'Verizon');

  const dupe = netflix.flags.find((f) => f.id === 'duplicate_category');
  assert.ok(dupe, 'two streaming services should be flagged');
  assert.equal(dupe.label, '2 streaming services');
  assert.match(dupe.detail, /Netflix, Hulu/);

  // Telecom is not substitutable — flagging it would be noise.
  assert.equal(flagIds(verizon).includes('duplicate_category'), false);
});

test('a small charge that has run for a year is surfaced, without claiming you do not use it', () => {
  const { series } = build([
    // 14 charges ending on NOW, so it is still active as well as long-running.
    { description: 'APPLE.COM/BILL ICLOUD', charges: monthly(14, 2.99, -25) },
  ]);
  const flag = series[0].flags.find((f) => f.id === 'easy_to_forget');
  assert.ok(flag, `expected easy_to_forget, got ${flagIds(series[0])}`);
  assert.match(flag.detail, /\$35\.88\/yr/);
  assert.match(flag.detail, /13 months/);
});

test('a stopped charge is excluded from committed spend', () => {
  const { series, summary } = build([
    { description: 'NETFLIX.COM', charges: monthly(12, 20.0) },
    // Ends 150 days before NOW.
    { description: 'PELOTON MEMBERSHIP', charges: monthly(6, 44.0, -300) },
  ]);
  const peloton = series.find((s) => s.name === 'Peloton');
  assert.equal(peloton.ended, true);
  assert.equal(peloton.verdict, 'ended');
  assert.equal(summary.activeCount, 1);
  assert.equal(summary.endedCount, 1);
  assert.equal(summary.monthlyTotal, 20);       // Peloton's $44 is not counted
  assert.equal(summary.annualTotal, 240);
});

test('the tool never marks anything "cancel" on its own', () => {
  const { series } = build([
    { description: 'NETFLIX.COM', charges: monthly(12, (i) => (i < 6 ? 9.99 : 19.99)) },
    // Priced above the "easy to forget" ceiling, so its only possible verdict is keep.
    { description: 'GITHUB.COM', charges: monthly(12, 21.0) },
  ]);
  assert.equal(series.some((s) => s.verdict === 'cancel'), false);
  assert.deepEqual(
    series.map((s) => s.verdict).sort(),
    ['keep', 'review'],   // the sharpest thing it will say is "decide about this"
  );
});

test('projected savings counts only what a human marked cancel', () => {
  const { series } = build([
    { description: 'NETFLIX.COM', charges: monthly(12, 17.99) },
    { description: 'HULU', charges: monthly(12, 17.99) },
  ]);
  assert.equal(projectedSavings(series, {}), 0);
  assert.equal(Number(projectedSavings(series, { HULU: 'cancel' }).toFixed(2)), 215.88);
});
