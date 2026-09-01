import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, sniffDelimiter } from '../public/engine/csv.js';
import { parseAmount, parseDate, detectDateOrder, detectSchema, normalizeTransactions } from '../public/engine/schema.js';

test('csv: quoted fields keep their commas', () => {
  const rows = parseCsv('date,description,amount\n01/02/2026,"ACME, INC. #12",-9.99');
  assert.deepEqual(rows[1], ['01/02/2026', 'ACME, INC. #12', '-9.99']);
});

test('csv: doubled quotes collapse to one', () => {
  const rows = parseCsv('a,b\n1,"say ""hi"" now"');
  assert.equal(rows[1][1], 'say "hi" now');
});

test('csv: CRLF and a UTF-8 BOM do not leak into the first header', () => {
  const rows = parseCsv('﻿date,amount\r\n01/02/2026,-1.00\r\n');
  assert.equal(rows[0][0], 'date');
  assert.equal(rows.length, 2);
});

test('csv: semicolon exports are detected, not shredded into one column', () => {
  assert.equal(sniffDelimiter('date;description;amount\n01.02.2026;NETFLIX;-9,99'), ';');
  const rows = parseCsv('date;description;amount\n01.02.2026;NETFLIX;-9,99');
  assert.deepEqual(rows[1], ['01.02.2026', 'NETFLIX', '-9,99']);
});

test('parseAmount: the shapes banks actually emit', () => {
  assert.equal(parseAmount('-15.49'), -15.49);
  assert.equal(parseAmount('$1,234.56'), 1234.56);
  assert.equal(parseAmount('(12.34)'), -12.34);       // accounting parens
  assert.equal(parseAmount('12.34-'), -12.34);        // trailing minus
  assert.equal(parseAmount('1.234,56'), 1234.56);     // EU: dot groups, comma decimal
  assert.equal(parseAmount('89,99'), 89.99);          // decimal comma
  assert.equal(parseAmount('-$2,500.00'), -2500);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('PENDING'), null);
});

test('parseDate: every common export format lands on the same instant', () => {
  const expected = Date.UTC(2026, 0, 5);
  assert.equal(parseDate('2026-01-05').getTime(), expected);
  assert.equal(parseDate('01/05/2026').getTime(), expected);
  assert.equal(parseDate('05/01/2026', true).getTime(), expected);
  assert.equal(parseDate('5 Jan 2026').getTime(), expected);
  assert.equal(parseDate('Jan 5, 2026').getTime(), expected);
  assert.equal(parseDate('not a date'), null);
});

test('parseDate: an impossible month overrides the caller', () => {
  // 13 cannot be a month, so this is day-first no matter what we were told.
  assert.equal(parseDate('13/04/2026', false).getTime(), Date.UTC(2026, 3, 13));
});

test('detectDateOrder: infers order from the data, and admits when it cannot', () => {
  assert.deepEqual(detectDateOrder(['01/13/2026', '02/28/2026']), { dayFirst: false, ambiguous: false });
  assert.deepEqual(detectDateOrder(['13/01/2026', '28/02/2026']), { dayFirst: true, ambiguous: false });
  // Every component <= 12: genuinely undecidable, and it must say so.
  assert.deepEqual(detectDateOrder(['01/02/2026', '03/04/2026']), { dayFirst: false, ambiguous: true });
});

test('detectSchema: finds the header under a bank preamble', () => {
  const rows = parseCsv([
    'FIRST CASCADE BANK',
    'Account: Checking (...4471)',
    '',
    'Transaction Date,Description,Amount,Balance',
    '01/17/2026,NETFLIX.COM,-17.99,900.00',
  ].join('\n'));
  const schema = detectSchema(rows);
  assert.equal(schema.ok, true);
  // Index 2, not 3: the blank line was already dropped by parseCsv.
  assert.equal(schema.headerIndex, 2);
  assert.equal(schema.date, 0);
  assert.equal(schema.description, 1);
  assert.equal(schema.amount, 2);
});

test('normalizeTransactions: negative amounts become positive money-out, credits stay negative', () => {
  const rows = parseCsv([
    'Date,Description,Amount',
    '01/17/2026,NETFLIX.COM,-17.99',
    '01/15/2026,ACME PAYROLL,3250.00',
  ].join('\n'));
  const result = normalizeTransactions(rows);
  assert.equal(result.ok, true);
  assert.equal(result.transactions.length, 2);
  // Sorted oldest first.
  assert.equal(result.transactions[0].description, 'ACME PAYROLL');
  assert.equal(result.transactions[0].amount, -3250);   // money in
  assert.equal(result.transactions[1].amount, 17.99);   // money out
});

test('normalizeTransactions: separate debit/credit columns are read by column, not by sign', () => {
  const rows = parseCsv([
    'Date,Description,Debit,Credit',
    '17/01/2026,NETFLIX,17.99,',
    '15/01/2026,SALARY,,3250.00',
  ].join('\n'));
  const result = normalizeTransactions(rows);
  assert.equal(result.ok, true);
  const netflix = result.transactions.find((t) => t.description === 'NETFLIX');
  const salary = result.transactions.find((t) => t.description === 'SALARY');
  assert.equal(netflix.amount, 17.99);
  assert.equal(salary.amount, -3250);
  assert.equal(netflix.date.getTime(), Date.UTC(2026, 0, 17));  // 17 forces day-first
});

test('normalizeTransactions: a charges-only export has no negatives to key off, and still works', () => {
  const rows = parseCsv([
    'Date,Description,Amount',
    '01/17/2026,NETFLIX.COM,17.99',
    '02/17/2026,NETFLIX.COM,17.99',
  ].join('\n'));
  const result = normalizeTransactions(rows);
  assert.equal(result.ok, true);
  assert.equal(result.transactions.every((t) => t.amount === 17.99), true);
});

test('normalizeTransactions: refuses a file it cannot read rather than inventing rows', () => {
  const rows = parseCsv('hello world\nthis is not a statement');
  const result = normalizeTransactions(rows);
  assert.equal(result.ok, false);
  assert.match(result.error, /date|amount|transactions/i);
});
