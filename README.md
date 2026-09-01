# Subscription X-Ray

Drop in a bank CSV. See every recurring charge, every price rise, and what the whole
pile costs you a year — then decide what stays.

The file never leaves your browser. There is no account, no upload, and no API call.
The page's own content-security policy sets `connect-src 'none'`, so the browser
_blocks_ it from talking to a network at all. That is not a promise in the marketing
copy; it is a rule the browser enforces.

## Run it

```bash
npm start
```

That is the whole thing. It serves the app, waits for it to answer, opens your
browser, and shuts down cleanly on Ctrl+C. **There is no install step — this project
has zero dependencies on purpose.** (`PORT=5174 npm start` if 5173 is taken.)

```bash
npm test      # 40+ assertions across parsing, detection, insights and the demo file
npm run sample  # regenerate the demo statement
```

## What it actually does

A bank statement is hostile input. Three problems have to be solved in order:

1. **Read the mess.** Preamble junk above the header, CRLF, BOMs, semicolon exports,
   `(12.34)` for negatives, `1.234,56` for European decimals, debit/credit columns
   instead of signed amounts, and `03/04/2026` which is March 4 in one country and
   April 3 in another. Ambiguous dates are inferred from the data when the data can
   settle it (`13/04` can only be day-first) and **surfaced as a question** when it
   cannot — never silently guessed.

2. **Collapse the merchant.** `SQ *NETFLIX.COM`, `NETFLIX.COM #4471 LOS GATOS CA` and
   `NETFLIX.COM LOS GATOS CA` are one vendor. Processor prefixes, store numbers, auth
   dates, phone numbers and city/state tails all get stripped. If they do not collapse,
   a subscription looks like a pile of one-off charges and nothing is ever found.

3. **Separate a subscription from a habit.** This is the actual problem. A coffee run
   every 3–11 days has a seven-day median, which lands squarely in the "weekly" band,
   and its amounts are stable enough to pass a naive amount check. What a billing
   system has that a habit does not is **regular timing**. So the gaps between charges
   must be tight (median absolute deviation ≤ 20% of the median interval), and the
   amount must hold still — unless the timing is *very* tight, in which case the amount
   is allowed to move, which is how a phone bill stays in and groceries stay out.

Every series carries a confidence, and two charges never earn the confidence of twelve.

## What it will and will not tell you

It flags only what a statement can actually prove:

| Flag | What it means |
| --- | --- |
| **Price up N%** | The current charge exceeds the first one, with the annual difference |
| **Renews in N days** | An annual or semiannual charge is inside its 45-day window — decide before it bills |
| **Trial converted** | The first charges were promotional; the current ones are not |
| **N streaming services** | Two or more *substitutable* services (streaming, music, news, storage…). A phone plan plus home internet is not flagged, because that is not a duplicate |
| **Easy to forget** | Small, and it has been charging for months. It does **not** claim you don't use it — a statement cannot know that |
| **Likely canceled** | A charge that was due and never arrived |

The sharpest thing the tool will say on its own is **Review**. It never marks anything
"cancel" for you — that is a judgment, and judgments belong to the person whose money
it is. Cancelling is a click, and the projected saving updates as you go.

Take the decision with you: **Download action plan** (Markdown) or **Export CSV**.

## Layout

```
public/           the app; this directory is what deploys
  engine/         pure ES modules — the same code the tests import
    csv.js        delimiter sniffing + RFC4180-ish reader
    schema.js     column detection, money parsing, date-order inference
    merchant.js   descriptor -> canonical merchant + category
    recurrence.js cadence detection and the habit/subscription split
    insights.js   flags, verdicts, totals
    report.js     the Markdown and CSV artifacts
    pipeline.js   raw CSV text in, decisions out
tests/            node:test, no framework
scripts/dev.mjs   the one command
scripts/make-sample.mjs  builds the demo statement (generated, so its cadences are provably consistent)
```

The engine is plain ES modules with no build step, so the browser and `node --test`
run the *same files*. There is nothing to transpile and nothing to trust.

## Deploying

Static. `vercel.json` pins `outputDirectory: public` with no build or install command,
and ships the same CSP the dev server sends, so local and production behave identically.

```bash
vercel deploy    # preview
```

## The demo statement

`public/sample-statement.js` is synthetic — no real person, account or card. It is
generated rather than typed so its cadences are internally consistent, and it is a
**module, not a `.csv`**, specifically so the app never has to `fetch()` it. That is
what lets the CSP stay at `connect-src 'none'`.

It contains, on purpose: a vendor under three descriptor shapes, a mid-life price rise,
a promo that converted, an annual renewal about to hit, two canceled services, a phone
bill whose amount moves every month — and a coffee habit, a grocery run and a payroll
deposit that must **not** be reported as subscriptions.
