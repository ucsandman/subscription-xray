import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMerchant } from '../public/engine/merchant.js';
import { detectRecurring } from '../public/engine/recurrence.js';

const NOW = new Date(Date.UTC(2026, 6, 12));   // 2026-07-12
const DAY = 86400000;

/** charges: [dayOffsetFromStart, amount][] */
function txns(description, charges, start = Date.UTC(2025, 6, 12)) {
  return charges.map(([offset, amount]) => ({
    date: new Date(start + offset * DAY),
    description,
    amount,
    merchant: normalizeMerchant(description),
  }));
}

function monthlyCharges(count, amount, { slop = 0, from = 0 } = {}) {
  return Array.from({ length: count }, (_, i) => [from + i * 30 + (i % 2 ? slop : 0), amount]);
}

test('a steady monthly charge is a subscription', () => {
  const { series } = detectRecurring(txns('NETFLIX.COM LOS GATOS CA', monthlyCharges(12, 15.49)), { now: NOW });
  assert.equal(series.length, 1);
  const s = series[0];
  assert.equal(s.name, 'Netflix');
  assert.equal(s.cadence, 'monthly');
  assert.equal(s.count, 12);
  assert.equal(s.currentAmount, 15.49);
  assert.equal(s.annualCost, 15.49 * 12);
  assert.equal(s.ended, false);
  assert.ok(s.confidence >= 0.9, `confidence was ${s.confidence}`);
});

test('a weekly coffee habit is NOT a subscription', () => {
  // Gaps of 3-11 days have a 7-day median, which lands in the weekly band, and
  // the amounts are close enough to pass an amount check. Only the raggedness
  // of the timing gives it away — if this test fails, the tool cries wolf on
  // everyone's coffee.
  const gaps = [0, 3, 12, 16, 27, 33, 41, 44, 54, 64];
  const charges = gaps.map((g, i) => [g, [4.25, 5.75, 4.5, 6.9, 5.1, 7.4, 4.8, 6.2, 5.5, 4.95][i]]);
  const { series, rejected } = detectRecurring(txns('BLUE BOTTLE COFFEE 1204', charges), { now: NOW });
  assert.equal(series.length, 0);
  assert.equal(rejected[0].reason, 'irregular-timing');
});

test('groceries are rejected on amount even when the timing is tidy', () => {
  const charges = monthlyCharges(6, 0).map(([d], i) => [d, [42.10, 188.44, 61.05, 233.90, 55.20, 301.75][i]]);
  const { series, rejected } = detectRecurring(txns('SAFEWAY #1422 SEATTLE WA', charges), { now: NOW });
  assert.equal(series.length, 0);
  assert.equal(rejected[0].reason, 'unstable-amount');
});

test('a utility bill may move in price, because its timing never does', () => {
  // Same billing day every month; the amount wanders. This must survive.
  const charges = [
    [0, 89.99], [31, 104.32], [59, 92.15], [90, 98.40], [120, 105.99], [151, 91.20],
  ];
  const { series } = detectRecurring(txns('VERIZON WIRELESS PAYMENTS', charges), { now: NOW });
  assert.equal(series.length, 1);
  assert.equal(series[0].cadence, 'monthly');
  assert.equal(series[0].variableAmount, true);
});

test('one charge is not a pattern', () => {
  const { series, rejected } = detectRecurring(txns('DELTA AIR LINES 0062143882611', [[0, 412.30]]), { now: NOW });
  assert.equal(series.length, 0);
  assert.equal(rejected[0].reason, 'only-one-charge');
});

test('a charge that stopped arriving is reported as stopped, not as active spend', () => {
  // Last charge 120 days ago on a monthly cadence: the next three never came.
  const start = NOW.getTime() - 300 * DAY;
  const charges = monthlyCharges(7, 16.99);   // spans 180 days, ends 120 days ago
  const { series } = detectRecurring(txns('HBO MAX HELP.MAX.COM', charges, start), { now: NOW });
  assert.equal(series.length, 1);
  assert.equal(series[0].ended, true);
});

test('an annual charge is found from two occurrences, but never trusted like twelve', () => {
  const charges = [[0, 239.88], [365, 263.88]];
  const { series } = detectRecurring(txns('ADOBE INC ADOBE.LY/ENSUB', charges, Date.UTC(2024, 7, 14)), { now: NOW });
  assert.equal(series.length, 1);
  const s = series[0];
  assert.equal(s.cadence, 'annual');
  assert.equal(s.chargesPerYear, 1);
  assert.equal(s.annualCost, 263.88);
  assert.equal(s.confidence, 0.45);   // two points, one interval: capped on purpose
  assert.equal(s.nextExpected.getTime(), Date.UTC(2026, 7, 14));
});

test('monthly cost is normalized across cadences so totals can be added up', () => {
  const { series } = detectRecurring(txns('ADOBE INC', [[0, 240], [365, 240]], Date.UTC(2025, 6, 12)), { now: NOW });
  assert.equal(Number(series[0].monthlyCost.toFixed(2)), 20);
});

test('two charges on the same day collapse into one occurrence', () => {
  const charges = [[0, 9.99], [0, 9.99], [30, 9.99], [60, 9.99], [90, 9.99]];
  const { series } = detectRecurring(txns('DOORDASH*DASHPASS 855-973-1040', charges), { now: NOW });
  assert.equal(series.length, 1);
  assert.equal(series[0].count, 4);          // not 5
  assert.equal(series[0].occurrences[0].amount, 19.98);
});

test('money coming in is never mistaken for a subscription', () => {
  const payroll = txns('ACME CORP PAYROLL DIRECT DEP', monthlyCharges(12, -3250));
  const { series } = detectRecurring(payroll, { now: NOW });
  assert.equal(series.length, 0);
});
