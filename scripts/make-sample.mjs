// Builds the demo statement. Generated rather than hand-written so the cadences
// are provably consistent (a hand-typed date that drifts by a week silently
// breaks the very detector this file is supposed to demonstrate).
//
// It ships as an ES module, not a .csv, so the app never has to fetch() it —
// which is what lets the CSP set connect-src 'none'.
//
// Run: npm run sample
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sample-statement.js');
const AS_OF = '2026-07-12';
const DAY = 86400000;

// Deterministic noise. Same file on every machine, every run.
function mulberry32(seed) {
  return function rand() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260712);

const rows = [];
const add = (date, description, amount) => {
  rows.push({ date: new Date(date), description, amount });
};

const d = (y, m, day) => new Date(Date.UTC(y, m - 1, day));
const jitter = (date, days) => new Date(date.getTime() + Math.round((rand() * 2 - 1) * days) * DAY);

/** Emit a charge every `stepMonths` on `day`, from start to end inclusive. */
function monthly({ start, end, day, stepMonths = 1, descriptors, amountAt, slop = 1 }) {
  let i = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const base = d(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, day);
    if (base >= start && base <= end) {
      const when = slop ? jitter(base, slop) : base;
      const desc = descriptors[i % descriptors.length];
      add(when, desc, -amountAt(i, when));
      i++;
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + stepMonths);
  }
}

const START = d(2024, 7, 1);
const END = d(2026, 7, 10);

// --- Subscriptions -------------------------------------------------------
// Netflix: three different descriptor shapes for one vendor, plus a mid-life
// price rise. Proves normalization and the price-increase flag together.
monthly({
  start: START, end: END, day: 17,
  descriptors: ['NETFLIX.COM LOS GATOS CA', 'SQ *NETFLIX.COM', 'NETFLIX.COM #4471 LOS GATOS CA'],
  amountAt: (_i, when) => (when >= d(2026, 1, 1) ? 17.99 : 15.49),
});

monthly({
  start: START, end: END, day: 3,
  descriptors: ['SPOTIFY USA NEW YORK NY', 'PAYPAL *SPOTIFY USA'],
  amountAt: () => 11.99,
});

monthly({ start: START, end: END, day: 22, descriptors: ['HULU 877-8244858 CA'], amountAt: () => 17.99 });
monthly({ start: START, end: END, day: 9, descriptors: ['DISNEY PLUS BURBANK CA'], amountAt: () => 13.99 });

// Max: stopped charging in March. Should read as "likely canceled", not active.
monthly({
  start: START, end: d(2026, 3, 20), day: 14,
  descriptors: ['HBO MAX HELP.MAX.COM'], amountAt: () => 16.99,
});

// Adobe: annual, renews ~33 days after AS_OF, and it went up 10%.
add(d(2024, 8, 14), 'ADOBE INC ADOBE.LY/ENSUB', -239.88);
add(d(2025, 8, 14), 'ADOBE INC ADOBE.LY/ENSUB', -263.88);

// Amazon Prime: annual, next charge is further out — shows an annual that is
// NOT urgent, so "renews soon" is visibly a threshold and not a label on
// everything annual.
add(d(2024, 9, 2), 'AMAZON PRIME MEMBERSHIP AMZN.COM/BILL', -139.00);
add(d(2025, 9, 2), 'AMAZON PRIME MEMBERSHIP AMZN.COM/BILL', -139.00);

// Notion: promo pricing that ended. Trial-converted + price increase.
monthly({
  start: START, end: END, day: 28,
  descriptors: ['NOTION LABS INC SAN FRANCISCO CA'],
  amountAt: (i) => (i < 3 ? 3.99 : 10.00),
});

monthly({ start: START, end: END, day: 6, descriptors: ['OPENAI *CHATGPT SUBSCR'], amountAt: () => 20.00 });
monthly({ start: START, end: END, day: 11, descriptors: ['GITHUB.COM 877-448-4820 CA'], amountAt: () => 4.00 });

// Small, long-running, easy to lose track of.
monthly({ start: START, end: END, day: 19, descriptors: ['APPLE.COM/BILL ICLOUD 866-712-7753'], amountAt: () => 2.99 });
monthly({ start: START, end: END, day: 1, descriptors: ['PLANET FIT CLUB FEES 800-3663488'], amountAt: () => 10.00 });
monthly({ start: START, end: END, day: 25, descriptors: ['NYTIMES *NYTIMES 800-698-4637'], amountAt: () => 4.25 });
monthly({ start: START, end: END, day: 12, descriptors: ['1PASSWORD SUBSCRIPTION'], amountAt: () => 2.99 });

// Substack: a second News charge, so the duplicate-category flag has something
// real to point at.
monthly({ start: START, end: END, day: 8, descriptors: ['SUBSTACK *STRATECHERY'], amountAt: () => 15.00 });

// Verizon: same billing day every month, amount wanders. This is the case the
// "tightly clocked charges may vary in price" rule exists for.
monthly({
  start: START, end: END, day: 21, slop: 0,
  descriptors: ['VERIZON WIRELESS PAYMENTS'],
  amountAt: () => Number((89.99 + rand() * 30).toFixed(2)),
});
monthly({ start: START, end: END, day: 5, descriptors: ['COMCAST XFINITY 800-COMCAST'], amountAt: () => 79.99 });
monthly({ start: START, end: END, day: 16, descriptors: ['GEICO *AUTO PAYMENT'], amountAt: () => 128.44 });
monthly({ start: START, end: END, day: 27, descriptors: ['DOORDASH*DASHPASS 855-973-1040'], amountAt: () => 9.99 });

// Peloton: canceled last winter.
monthly({
  start: START, end: d(2025, 12, 15), day: 2,
  descriptors: ['PELOTON MEMBERSHIP NEW YORK NY'], amountAt: () => 44.00,
});

// --- Noise that must NOT be called a subscription ------------------------
// A coffee habit: roughly weekly, but the gaps and the amounts both wander.
let coffee = d(2024, 7, 3);
while (coffee <= END) {
  add(coffee, `BLUE BOTTLE COFFEE ${1200 + Math.floor(rand() * 700)}`, -Number((4.25 + rand() * 3.5).toFixed(2)));
  coffee = new Date(coffee.getTime() + (3 + Math.floor(rand() * 9)) * DAY);
}

let groceries = d(2024, 7, 5);
while (groceries <= END) {
  add(groceries, `SAFEWAY #${1400 + Math.floor(rand() * 90)} SEATTLE WA`, -Number((38 + rand() * 145).toFixed(2)));
  groceries = new Date(groceries.getTime() + (5 + Math.floor(rand() * 8)) * DAY);
}

let shopping = d(2024, 7, 9);
while (shopping <= END) {
  add(shopping, `AMZN Mktp US*${Math.floor(rand() * 900000).toString(36).toUpperCase()}`, -Number((9 + rand() * 120).toFixed(2)));
  shopping = new Date(shopping.getTime() + (4 + Math.floor(rand() * 14)) * DAY);
}

const oneOffs = [
  [d(2024, 8, 23), 'DELTA AIR LINES 0062143882611', 412.30],
  [d(2024, 11, 29), 'BEST BUY #1123 SEATTLE WA', 249.99],
  [d(2025, 2, 14), 'CANLIS RESTAURANT SEATTLE WA', 318.44],
  [d(2025, 5, 30), 'SHELL OIL 57445558804', 62.18],
  [d(2025, 9, 12), 'THE HOME DEPOT #4703', 187.65],
  [d(2026, 1, 8), 'ALASKA AIR 0272198334521', 288.40],
  [d(2026, 4, 19), 'REI #11 SEATTLE WA', 143.22],
];
for (const [when, desc, amt] of oneOffs) add(when, desc, -amt);

// --- Money in ------------------------------------------------------------
let payday = d(2024, 7, 15);
while (payday <= END) {
  add(payday, 'ACME CORP PAYROLL DIRECT DEP', 3250.00);
  payday = new Date(payday.getTime() + 14 * DAY);
}
add(d(2025, 3, 19), 'NETFLIX.COM REFUND', 15.49);

// --- Emit ----------------------------------------------------------------
// Banks export newest-first, with junk above the header and inconsistent
// number formatting. Reproduce all three.
rows.sort((a, b) => b.date - a.date);

const fmtDate = (dt) =>
  `${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCDate()).padStart(2, '0')}/${dt.getUTCFullYear()}`;

const fmtAmount = (n) => {
  const abs = Math.abs(n);
  const withCommas = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Large values carry a currency symbol and thousands separator; small ones do
  // not. Real exports are exactly this inconsistent.
  const body = abs >= 1000 ? `$${withCommas}` : abs.toFixed(2);
  return n < 0 ? `-${body}` : body;
};

const quote = (s) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

const lines = [
  'FIRST CASCADE BANK - TRANSACTION EXPORT',
  'Account: Everyday Checking (...4471)',
  'Period: 07/01/2024 - 07/10/2026',
  '',
  'Transaction Date,Description,Amount,Balance',
];
let balance = 18420.55;
for (const r of rows) {
  balance += r.amount;
  lines.push([fmtDate(r.date), quote(r.description), fmtAmount(r.amount), balance.toFixed(2)].join(','));
}

const csv = lines.join('\r\n');
const file = `// GENERATED by scripts/make-sample.mjs - do not edit by hand.
// A synthetic statement. No real person, account, or card is represented.
export const SAMPLE_AS_OF = '${AS_OF}';
export const SAMPLE_CSV = ${JSON.stringify(csv)};
`;
writeFileSync(OUT, file);
console.log(`wrote ${OUT} — ${rows.length} transactions`);
