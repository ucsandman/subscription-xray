// The whole product in one function: raw CSV text in, decisions out.
import { parseCsv } from './csv.js';
import { normalizeTransactions } from './schema.js';
import { normalizeMerchant } from './merchant.js';
import { detectRecurring } from './recurrence.js';
import { analyze } from './insights.js';

/**
 * @param {string} csvText raw file contents
 * @param {{now?: Date, dayFirst?: boolean}} options
 * @returns {{ok: true, series, summary, schema, stats} | {ok: false, error: string}}
 */
export function analyzeStatement(csvText, options = {}) {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return { ok: false, error: 'That file is empty.' };

  const normalized = normalizeTransactions(rows, { dayFirst: options.dayFirst });
  if (!normalized.ok) return { ok: false, error: normalized.error };

  const transactions = normalized.transactions.map((t) => ({
    ...t,
    merchant: normalizeMerchant(t.description),
  }));

  const { series, rejected } = detectRecurring(transactions, { now: options.now });
  const { series: enriched, summary } = analyze(series, { now: options.now });

  const outflows = transactions.filter((t) => t.amount > 0);
  return {
    ok: true,
    series: enriched,
    // Pre-insight series, so the UI can re-run analyze() after the human
    // dismisses a false positive — flags and totals then stay consistent
    // instead of quietly describing a row that is no longer on screen.
    detected: series,
    summary,
    schema: normalized.schema,
    stats: {
      transactions: transactions.length,
      outflows: outflows.length,
      skippedRows: normalized.skipped,
      merchants: rejected.length + series.length,
      spanDays: transactions.length
        ? Math.round((transactions[transactions.length - 1].date - transactions[0].date) / 86400000)
        : 0,
    },
  };
}
