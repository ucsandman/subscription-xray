// Recurring-charge detection.
//
// The hard part is not finding repeats, it is NOT finding them: a coffee shop
// visited most weeks repeats too. A subscription is separated from a habit by
// two signals a habit does not have — the gaps between charges are regular, and
// the amount barely moves. Both must hold, and every series carries a
// confidence the UI shows, because the final call belongs to a human.

const DAY = 86400000;

const CADENCES = [
  { name: 'weekly', min: 5, max: 9, perYear: 52.18 },
  { name: 'biweekly', min: 12, max: 17, perYear: 26.09 },
  { name: 'monthly', min: 25, max: 35, perYear: 12 },
  { name: 'bimonthly', min: 55, max: 70, perYear: 6 },
  { name: 'quarterly', min: 80, max: 100, perYear: 4 },
  { name: 'semiannual', min: 165, max: 200, perYear: 2 },
  { name: 'annual', min: 340, max: 400, perYear: 1 },
];

export const CADENCE_LABELS = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  bimonthly: 'Every 2 months',
  quarterly: 'Quarterly',
  semiannual: 'Every 6 months',
  annual: 'Annual',
};

export function median(values) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation — robust to one late payment. */
function mad(values) {
  if (values.length === 0) return 0;
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

function coefficientOfVariation(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function classifyCadence(days) {
  return CADENCES.find((c) => days >= c.min && days <= c.max) || null;
}

function confidenceFor(count, intervalNoise, amountNoise) {
  const base = { 2: 0.45, 3: 0.65, 4: 0.75, 5: 0.82 }[count] ?? 0.9;
  // Two charges give one interval, which is trivially "regular". Never let that
  // masquerade as a confident series.
  if (count === 2) return 0.45;
  const regular = 1 - Math.min(1, intervalNoise / 0.2);
  const stable = 1 - Math.min(1, amountNoise / 0.3);
  return Math.min(0.99, Number((base + regular * 0.06 + stable * 0.04).toFixed(2)));
}

/** Collapse multiple charges on one day into a single occurrence. */
function toOccurrences(transactions) {
  const byDate = new Map();
  for (const t of transactions) {
    const stamp = t.date.getTime();
    const existing = byDate.get(stamp);
    if (existing) existing.amount += t.amount;
    else byDate.set(stamp, { date: t.date, amount: t.amount, description: t.description });
  }
  return [...byDate.values()].sort((a, b) => a.date - b.date);
}

/**
 * @param {Array} transactions normalized txns (positive amount = money out)
 * @param {{now?: Date}} options
 * @returns {{series: Array, rejected: Array}}
 */
export function detectRecurring(transactions, options = {}) {
  const now = options.now || new Date();
  const outflows = transactions.filter((t) => t.amount > 0);

  const groups = new Map();
  for (const t of outflows) {
    const merchant = t.merchant;
    if (!groups.has(merchant.key)) groups.set(merchant.key, { merchant, txns: [] });
    groups.get(merchant.key).txns.push(t);
  }

  const series = [];
  const rejected = [];

  for (const { merchant, txns } of groups.values()) {
    const occurrences = toOccurrences(txns);
    if (occurrences.length < 2) {
      rejected.push({ merchant, reason: 'only-one-charge', occurrences: occurrences.length });
      continue;
    }

    const intervals = [];
    for (let i = 1; i < occurrences.length; i++) {
      intervals.push(Math.round((occurrences[i].date - occurrences[i - 1].date) / DAY));
    }
    const medianInterval = median(intervals);
    const cadence = classifyCadence(medianInterval);
    if (!cadence) {
      rejected.push({ merchant, reason: 'no-regular-cadence', medianInterval });
      continue;
    }

    const intervalNoise = medianInterval > 0 ? mad(intervals) / medianInterval : 1;
    const amounts = occurrences.map((o) => o.amount);
    const amountNoise = coefficientOfVariation(amounts);

    // 0.2 is load-bearing. A coffee run every 3-11 days has a ~7 day median,
    // which lands squarely in the "weekly" band and whose amounts are stable
    // enough to slip past the amount check. Only the tightness of the gaps
    // separates a billing system from a habit, so this stays strict: a monthly
    // sub may drift 6 days, a weekly one 1.4.
    if (intervalNoise > 0.2) {
      rejected.push({ merchant, reason: 'irregular-timing', intervalNoise });
      continue;
    }
    // A tightly clocked charge is allowed to move in price (utilities, usage
    // billing); a loosely clocked one is not (that is a shopping habit).
    const amountCeiling = intervalNoise <= 0.12 && occurrences.length >= 3 ? 0.6 : 0.25;
    if (amountNoise > amountCeiling) {
      rejected.push({ merchant, reason: 'unstable-amount', amountNoise });
      continue;
    }

    const last = occurrences[occurrences.length - 1];
    const first = occurrences[0];
    const currentAmount = last.amount;
    const nextExpected = new Date(last.date.getTime() + medianInterval * DAY);
    const daysSinceLast = (now - last.date) / DAY;
    const ended = daysSinceLast > medianInterval * 1.75 + 5;

    const monthlyCost = (currentAmount * cadence.perYear) / 12;

    series.push({
      key: merchant.key,
      name: merchant.name,
      category: merchant.category,
      known: merchant.known,
      cadence: cadence.name,
      cadenceLabel: CADENCE_LABELS[cadence.name],
      chargesPerYear: cadence.perYear,
      occurrences,
      count: occurrences.length,
      medianInterval,
      currentAmount,
      firstAmount: first.amount,
      firstSeen: first.date,
      lastSeen: last.date,
      nextExpected,
      ended,
      monthlyCost,
      annualCost: currentAmount * cadence.perYear,
      variableAmount: amountNoise > 0.05,
      confidence: confidenceFor(occurrences.length, intervalNoise, amountNoise),
    });
  }

  series.sort((a, b) => b.annualCost - a.annualCost);
  return { series, rejected };
}
