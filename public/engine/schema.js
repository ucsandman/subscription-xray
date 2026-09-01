// Turns an arbitrary bank-export grid into normalized transactions.
//
// Two things every export disagrees about and this module decides explicitly:
//   1. Which columns hold the date, the description, and the money.
//   2. Whether 03/04/2026 means March 4 or April 3.
// Ambiguous dates are resolved per-column from the data when possible; when the
// data cannot settle it, the assumption is returned so the UI can show it and
// let a human flip it. It is never silently guessed.

const HEADER_PATTERNS = {
  date: /^(transaction |posting |posted |post |trans |booking |value |completed )?date( posted)?$/i,
  description: /^(description|merchant|payee|name|details|memo|narrative|particulars|transaction|reference)$/i,
  amount: /^(amount|value|transaction amount|amount \(usd\))$/i,
  debit: /^(debit|withdrawal|withdrawals|money out|paid out|charge|charges|outflow)$/i,
  credit: /^(credit|deposit|deposits|money in|paid in|inflow)$/i,
};

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse money in the shapes banks actually emit. Returns null if not money. */
export function parseAmount(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (s === '') return null;

  let negative = false;
  // Accounting parens: (12.34) === -12.34
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Trailing minus: 12.34-
  if (/-$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/[$£€¥\s]/g, '');
  if (/^-/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Whichever separator comes last is the decimal point.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const decimals = s.length - lastComma - 1;
    // "1,50" is decimal comma; "1,500" is a thousands group.
    if (decimals === 2 && s.indexOf(',') === lastComma) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Parse a date. `dayFirst` only affects all-numeric ambiguous forms.
 * Returns a UTC-midnight Date, or null.
 */
export function parseDate(raw, dayFirst = false) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '') return null;

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return utc(+m[1], +m[2], +m[3]);

  // 5 Jan 2026 / 5-Jan-26
  m = s.match(/^(\d{1,2})[\s\-/]([A-Za-z]{3,})[\s\-/](\d{2,4})$/);
  if (m) return utc(year(+m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);

  // Jan 5, 2026
  m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (m) return utc(year(+m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = year(+m[3]);
    // The data can override the caller: 13/04 can only be day-first.
    if (a > 12) return utc(y, b, a);
    if (b > 12) return utc(y, a, b);
    return dayFirst ? utc(y, b, a) : utc(y, a, b);
  }
  return null;
}

function year(y) {
  return y < 100 ? 2000 + y : y;
}

function utc(y, mo, d) {
  if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * Decide whether an all-numeric date column is day-first.
 * Returns { dayFirst, ambiguous } — ambiguous means the data alone cannot tell,
 * so the UI must surface the assumption.
 */
export function detectDateOrder(values) {
  let firstOver12 = false;
  let secondOver12 = false;
  let numeric = 0;
  for (const v of values) {
    const m = String(v).trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) continue;
    numeric++;
    if (+m[1] > 12) firstOver12 = true;
    if (+m[2] > 12) secondOver12 = true;
  }
  if (numeric === 0) return { dayFirst: false, ambiguous: false };
  if (firstOver12 && !secondOver12) return { dayFirst: true, ambiguous: false };
  if (secondOver12 && !firstOver12) return { dayFirst: false, ambiguous: false };
  return { dayFirst: false, ambiguous: true };
}

function scoreHeader(cells) {
  let score = 0;
  for (const cell of cells) {
    for (const re of Object.values(HEADER_PATTERNS)) {
      if (re.test(cell)) {
        score++;
        break;
      }
    }
  }
  return score;
}

/** Locate the header row (banks love preamble junk) and map the columns. */
export function detectSchema(rows) {
  let headerIndex = -1;
  let bestScore = 1; // require at least 2 recognizable headers
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i++) {
    const score = scoreHeader(rows[i]);
    if (score > bestScore) {
      bestScore = score;
      headerIndex = i;
    }
  }

  const cols = { date: -1, description: -1, amount: -1, debit: -1, credit: -1 };
  if (headerIndex >= 0) {
    rows[headerIndex].forEach((cell, i) => {
      for (const [field, re] of Object.entries(HEADER_PATTERNS)) {
        if (cols[field] === -1 && re.test(cell)) cols[field] = i;
      }
    });
  }

  const body = rows.slice(headerIndex + 1);
  if (body.length === 0) {
    return { ok: false, error: 'No data rows found.', headerIndex, ...cols };
  }

  // Headerless or unlabelled export: infer from the content of each column.
  if (cols.date === -1) cols.date = inferColumn(body, (v) => parseDate(v) !== null);
  if (cols.amount === -1 && cols.debit === -1) {
    cols.amount = inferColumn(body, (v) => parseAmount(v) !== null, [cols.date]);
  }
  if (cols.description === -1) cols.description = inferTextColumn(body, [cols.date, cols.amount, cols.debit, cols.credit]);

  if (cols.date === -1) return { ok: false, error: 'Could not find a date column.', headerIndex, ...cols };
  if (cols.description === -1) return { ok: false, error: 'Could not find a description column.', headerIndex, ...cols };
  if (cols.amount === -1 && cols.debit === -1) {
    return { ok: false, error: 'Could not find an amount column.', headerIndex, ...cols };
  }

  const order = detectDateOrder(body.map((r) => r[cols.date] || ''));
  return { ok: true, headerIndex, ...cols, ...order };
}

function inferColumn(body, predicate, skip = []) {
  const width = Math.max(...body.map((r) => r.length));
  let best = -1;
  let bestHits = 0;
  for (let c = 0; c < width; c++) {
    if (skip.includes(c)) continue;
    const hits = body.filter((r) => predicate(r[c] || '')).length;
    if (hits > bestHits && hits >= body.length * 0.6) {
      bestHits = hits;
      best = c;
    }
  }
  return best;
}

function inferTextColumn(body, skip) {
  const width = Math.max(...body.map((r) => r.length));
  let best = -1;
  let bestLen = 0;
  for (let c = 0; c < width; c++) {
    if (skip.includes(c)) continue;
    const avg = body.reduce((sum, r) => sum + String(r[c] || '').length, 0) / body.length;
    if (avg > bestLen && avg >= 4) {
      bestLen = avg;
      best = c;
    }
  }
  return best;
}

/**
 * Normalize rows into transactions where `amount` is POSITIVE money OUT.
 * Inflows (salary, refunds) are returned with a negative amount so callers can
 * exclude them; nothing is silently dropped.
 *
 * @returns {{ok: true, transactions: Array, schema: object, skipped: number} | {ok: false, error: string}}
 */
export function normalizeTransactions(rows, overrides = {}) {
  const schema = detectSchema(rows);
  if (!schema.ok) return { ok: false, error: schema.error };

  const dayFirst = overrides.dayFirst !== undefined ? overrides.dayFirst : schema.dayFirst;
  const body = rows.slice(schema.headerIndex + 1);
  const transactions = [];
  let skipped = 0;

  // Sign convention: if a plain amount column carries both signs, negatives are
  // the outflows. If every value is positive there is no credit column to
  // contrast with, so the file is charges-only and all rows are outflows.
  let negativeIsOut = true;
  if (schema.amount !== -1) {
    const amounts = body.map((r) => parseAmount(r[schema.amount] || '')).filter((n) => n !== null);
    negativeIsOut = amounts.some((n) => n < 0);
  }

  for (const row of body) {
    const date = parseDate(row[schema.date] || '', dayFirst);
    const description = String(row[schema.description] || '').trim();
    if (!date || description === '') {
      skipped++;
      continue;
    }

    let amount = null;
    if (schema.debit !== -1 || schema.credit !== -1) {
      const debit = schema.debit !== -1 ? parseAmount(row[schema.debit] || '') : null;
      const credit = schema.credit !== -1 ? parseAmount(row[schema.credit] || '') : null;
      if (debit !== null && debit !== 0) amount = Math.abs(debit);
      else if (credit !== null && credit !== 0) amount = -Math.abs(credit);
    } else {
      const value = parseAmount(row[schema.amount] || '');
      if (value !== null) amount = negativeIsOut ? -value : value;
    }

    if (amount === null || amount === 0) {
      skipped++;
      continue;
    }
    transactions.push({ date, description, amount });
  }

  if (transactions.length === 0) {
    return { ok: false, error: 'No usable transactions found in this file.' };
  }
  transactions.sort((a, b) => a.date - b.date);
  return { ok: true, transactions, schema: { ...schema, dayFirst }, skipped };
}
