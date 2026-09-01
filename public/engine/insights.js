// Flags and verdicts.
//
// Rule for this file: every flag must be provable from the statement itself.
// A statement cannot tell you whether someone still watches Hulu, so this code
// never claims it does. It says "this is small, it has run for 14 months, and
// it costs $107/yr" and lets the human draw the conclusion. The tool decides
// KEEP or REVIEW; only a person decides CANCEL.

const DAY = 86400000;

// Paying for two of these is a question worth asking; paying for both a phone
// plan and home internet is not. Only substitutable categories get flagged, or
// the flag becomes noise and people stop reading it.
const OVERLAPPING = new Set(['Streaming', 'Music', 'News', 'Storage', 'Fitness', 'Food', 'Security', 'Education', 'Gaming']);

export function analyze(series, options = {}) {
  const now = options.now || new Date();

  const active = series.filter((s) => !s.ended);
  const categoryCounts = new Map();
  for (const s of active) {
    categoryCounts.set(s.category, (categoryCounts.get(s.category) || 0) + 1);
  }

  const enriched = series.map((s) => {
    const flags = [];

    if (s.ended) {
      flags.push({
        id: 'ended',
        severity: 'info',
        label: 'Likely canceled',
        detail: `No charge since ${fmtDate(s.lastSeen)}; one was due around ${fmtDate(s.nextExpected)}.`,
      });
    }

    const increase = priceIncrease(s);
    if (increase) {
      flags.push({
        id: 'price_increase',
        severity: 'warn',
        label: `Price up ${increase.pct}%`,
        detail: `Was ${money(s.firstAmount)}, now ${money(s.currentAmount)} — ${money(increase.annualDelta)}/yr more than when you signed up.`,
      });
    }

    if (trialConverted(s)) {
      flags.push({
        id: 'trial_converted',
        severity: 'warn',
        label: 'Trial converted',
        detail: `First charge was ${money(s.firstAmount)}, now ${money(s.currentAmount)} every ${s.medianInterval} days.`,
      });
    }

    if (!s.ended && renewsSoon(s, now)) {
      const days = Math.max(0, Math.round((s.nextExpected - now) / DAY));
      flags.push({
        id: 'renews_soon',
        severity: 'warn',
        label: `Renews in ${days} day${days === 1 ? '' : 's'}`,
        detail: `${money(s.currentAmount)} will be charged around ${fmtDate(s.nextExpected)}. Decide before it renews.`,
      });
    }

    if (!s.ended && OVERLAPPING.has(s.category) && (categoryCounts.get(s.category) || 0) > 1) {
      const peers = active.filter((o) => o.category === s.category);
      const total = peers.reduce((sum, o) => sum + o.monthlyCost, 0);
      flags.push({
        id: 'duplicate_category',
        severity: 'warn',
        label: `${peers.length} ${s.category.toLowerCase()} services`,
        detail: `${peers.map((p) => p.name).join(', ')} — ${money(total)}/mo combined.`,
      });
    }

    if (!s.ended && easyToForget(s, now)) {
      const months = Math.round((now - s.firstSeen) / DAY / 30.44);
      flags.push({
        // Informational, not a warning. "Review" has to mean something changed
        // or overlaps — if being cheap were enough to earn it, 13 of 18 rows
        // light up and the badge stops meaning anything.
        id: 'easy_to_forget',
        severity: 'info',
        label: 'Easy to forget',
        detail: `${money(s.currentAmount)} is small enough to ignore, but it has charged for ${months} months — ${money(s.annualCost)}/yr.`,
      });
    }

    if (s.confidence < 0.6) {
      flags.push({
        id: 'low_confidence',
        severity: 'info',
        label: 'Unsure',
        detail: `Only ${s.count} charges seen. Confirm this is really a subscription.`,
      });
    }

    const verdict = s.ended ? 'ended' : flags.some((f) => f.severity === 'warn') ? 'review' : 'keep';
    return { ...s, flags, verdict };
  });

  enriched.sort((a, b) => {
    if (a.ended !== b.ended) return a.ended ? 1 : -1;
    return b.annualCost - a.annualCost;
  });

  return { series: enriched, summary: summarize(enriched) };
}

function priceIncrease(s) {
  if (s.firstAmount <= 0) return null;
  if (s.currentAmount <= s.firstAmount * 1.02) return null;
  const pct = Math.round(((s.currentAmount - s.firstAmount) / s.firstAmount) * 100);
  const annualDelta = (s.currentAmount - s.firstAmount) * s.chargesPerYear;
  return { pct, annualDelta };
}

function trialConverted(s) {
  return s.firstAmount === 0 || (s.firstAmount > 0 && s.firstAmount < s.currentAmount * 0.4);
}

function renewsSoon(s, now) {
  if (s.cadence !== 'annual' && s.cadence !== 'semiannual') return false;
  const days = (s.nextExpected - now) / DAY;
  return days >= 0 && days <= 45;
}

function easyToForget(s, now) {
  const tenureDays = (now - s.firstSeen) / DAY;
  return s.monthlyCost < 15 && tenureDays >= 180 && s.count >= 6;
}

function summarize(series) {
  const active = series.filter((s) => !s.ended);
  const monthlyTotal = active.reduce((sum, s) => sum + s.monthlyCost, 0);
  const byCategory = [...active.reduce((map, s) => {
    const row = map.get(s.category) || { category: s.category, count: 0, monthly: 0 };
    row.count++;
    row.monthly += s.monthlyCost;
    map.set(s.category, row);
    return map;
  }, new Map()).values()].sort((a, b) => b.monthly - a.monthly);

  return {
    activeCount: active.length,
    endedCount: series.length - active.length,
    monthlyTotal,
    annualTotal: monthlyTotal * 12,
    reviewCount: active.filter((s) => s.verdict === 'review').length,
    byCategory,
  };
}

/** Annual cost of everything the human marked "cancel". */
export function projectedSavings(series, decisions) {
  return series
    .filter((s) => !s.ended && decisions[s.key] === 'cancel')
    .reduce((sum, s) => sum + s.annualCost, 0);
}

export function money(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
