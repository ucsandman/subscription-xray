// End to end, on the exact file the "Try it with a sample statement" button
// loads. If the demo lies, this fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStatement } from '../public/engine/pipeline.js';
import { SAMPLE_CSV, SAMPLE_AS_OF } from '../public/sample-statement.js';

const NOW = new Date(`${SAMPLE_AS_OF}T00:00:00Z`);
const result = analyzeStatement(SAMPLE_CSV, { now: NOW });

const find = (name) => result.series.find((s) => s.name === name);
const flagsOf = (name) => find(name).flags.map((f) => f.id);

test('the sample statement parses without a hint', () => {
  assert.equal(result.ok, true);
  assert.equal(result.schema.ambiguous, false);   // MM/DD is provable from the data
  assert.equal(result.schema.dayFirst, false);
  assert.ok(result.stats.transactions > 400, `only ${result.stats.transactions} transactions`);
  assert.ok(result.stats.spanDays > 700, `only ${result.stats.spanDays} days`);
});

test('noise is not sold as a subscription', () => {
  // The three traps in the file: a coffee habit, a grocery run, and Amazon.
  assert.equal(find('Blue Bottle Coffee'), undefined);
  assert.equal(result.series.some((s) => s.name.startsWith('Safeway')), false);
  assert.equal(result.series.some((s) => s.name.startsWith('Amzn')), false);
  // Payroll arrives every two weeks like clockwork. It is money IN.
  assert.equal(result.series.some((s) => /payroll|acme/i.test(s.name)), false);
  // One-off travel and restaurants.
  assert.equal(result.series.some((s) => /delta|canlis|best buy/i.test(s.name)), false);
});

test('three descriptor shapes of Netflix collapse into one series with its price rise', () => {
  const netflix = find('Netflix');
  assert.ok(netflix, 'Netflix was not detected');
  assert.equal(netflix.cadence, 'monthly');
  assert.equal(netflix.currentAmount, 17.99);
  assert.equal(netflix.firstAmount, 15.49);
  assert.ok(netflix.count >= 24, `only ${netflix.count} charges matched`);
  assert.ok(flagsOf('Netflix').includes('price_increase'));
  assert.ok(netflix.confidence >= 0.9, `confidence ${netflix.confidence}`);
});

test('services that stopped charging are separated from the ones still billing', () => {
  assert.equal(find('Max').ended, true);        // last charged March
  assert.equal(find('Peloton').ended, true);    // canceled in December
  assert.equal(find('Netflix').ended, false);
});

test('the annual charge about to renew is the one it warns about', () => {
  const adobe = find('Adobe');
  assert.equal(adobe.cadence, 'annual');
  assert.ok(flagsOf('Adobe').includes('renews_soon'), `Adobe flags: ${flagsOf('Adobe')}`);
  assert.ok(flagsOf('Adobe').includes('price_increase'));
  assert.equal(adobe.nextExpected.getTime(), Date.UTC(2026, 7, 14));

  // Prime is annual too, but not due for another 52 days: no warning.
  assert.equal(find('Amazon Prime').cadence, 'annual');
  assert.equal(flagsOf('Amazon Prime').includes('renews_soon'), false);
});

test('the stack of streaming services is named', () => {
  const dupe = find('Netflix').flags.find((f) => f.id === 'duplicate_category');
  assert.ok(dupe, 'expected a duplicate-category flag on Netflix');
  // Max already stopped charging, so it is not counted among the live ones.
  assert.equal(dupe.label, '3 streaming services');
  assert.equal(dupe.detail.includes('Max'), false);
});

test('the promo that quietly became full price is caught', () => {
  assert.ok(flagsOf('Notion').includes('trial_converted'));
  assert.equal(find('Notion').currentAmount, 10);
});

test('a phone bill that changes every month still counts as a subscription', () => {
  const verizon = find('Verizon');
  assert.equal(verizon.cadence, 'monthly');
  assert.equal(verizon.variableAmount, true);
});

test('the headline number is real money', () => {
  assert.ok(result.summary.activeCount >= 15, `only ${result.summary.activeCount} active`);
  assert.ok(
    result.summary.monthlyTotal > 400 && result.summary.monthlyTotal < 600,
    `monthly total was ${result.summary.monthlyTotal}`,
  );
  assert.equal(
    Number(result.summary.annualTotal.toFixed(2)),
    Number((result.summary.monthlyTotal * 12).toFixed(2)),
  );
  assert.ok(result.summary.reviewCount >= 4);
});
