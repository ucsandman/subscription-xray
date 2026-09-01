import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMerchant, cleanDescriptor } from '../public/engine/merchant.js';

test('one vendor, three descriptor shapes, one key', () => {
  // If these do not collapse, the vendor looks like three one-off charges and
  // no subscription is ever found. This is the load-bearing case.
  const keys = [
    'NETFLIX.COM LOS GATOS CA',
    'SQ *NETFLIX.COM',
    'NETFLIX.COM #4471 LOS GATOS CA',
  ].map((d) => normalizeMerchant(d).key);
  assert.deepEqual(keys, ['NETFLIX', 'NETFLIX', 'NETFLIX']);
});

test('processor prefixes are stripped', () => {
  // The country tail goes too, so "PAYPAL *SPOTIFY USA" and a plain "SPOTIFY"
  // charge land on the same vendor instead of splitting into two.
  assert.equal(cleanDescriptor('PAYPAL *SPOTIFY USA'), 'SPOTIFY');
  assert.equal(cleanDescriptor('POS DEBIT PLANET FIT CLUB FEES'), 'PLANET FIT CLUB FEES');
  assert.equal(cleanDescriptor('PURCHASE AUTHORIZED ON 03/14 HULU'), 'HULU');
});

test('trailing transaction ids, phone numbers and city/state tails are stripped', () => {
  assert.equal(cleanDescriptor('HULU 877-8244858 CA'), 'HULU');
  assert.equal(cleanDescriptor('HBO MAX HELP.MAX.COM'), 'HBO MAX');
  assert.equal(cleanDescriptor('CHECKCARD 0412 SPOTIFY USA XX4471'), 'SPOTIFY');
});

test('a long word in an address is not mistaken for a transaction id', () => {
  // "FRANCISCO" is nine characters of A-Z, which is exactly the shape of an
  // opaque id. Ids carry digits; cities do not.
  assert.equal(cleanDescriptor('ACME PLUMBING CO SAN FRANCISCO CA'), 'ACME PLUMBING');
  assert.equal(cleanDescriptor('SOME VENDOR 4X9F22QK1'), 'SOME VENDOR');
});

test('known merchants carry a category; that is what makes overlap detectable', () => {
  assert.deepEqual(normalizeMerchant('SPOTIFY USA NEW YORK NY'), {
    key: 'SPOTIFY', name: 'Spotify', category: 'Music', known: true,
  });
  assert.equal(normalizeMerchant('DOORDASH*DASHPASS 855-973-1040').category, 'Food');
  assert.equal(normalizeMerchant('GEICO *AUTO PAYMENT').name, 'GEICO');
  assert.equal(normalizeMerchant('OPENAI *CHATGPT SUBSCR').name, 'OpenAI');
});

test('unknown merchants still group, and are honest about being unknown', () => {
  const a = normalizeMerchant('BLUE BOTTLE COFFEE 1204');
  const b = normalizeMerchant('BLUE BOTTLE COFFEE 1871');
  assert.equal(a.key, b.key);            // same shop, different store number
  assert.equal(a.known, false);
  assert.equal(a.category, 'Other');
  assert.equal(a.name, 'Blue Bottle Coffee');
});

test('cleaning never eats the whole descriptor', () => {
  assert.notEqual(cleanDescriptor('SQ *TST'), '');
});
