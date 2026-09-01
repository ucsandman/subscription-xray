import { analyzeStatement } from './engine/pipeline.js';
import { analyze, money, fmtDate, projectedSavings } from './engine/insights.js';
import { toMarkdown, toCsv } from './engine/report.js';

const DECISIONS_KEY = 'sxray.decisions.v1';
const DISMISSED_KEY = 'sxray.dismissed.v1';

const state = {
  detected: [],
  schema: null,
  stats: null,
  now: new Date(),
  dayFirst: false,
  csv: '',
  decisions: load(DECISIONS_KEY, {}),
  dismissed: new Set(load(DISMISSED_KEY, [])),
  expanded: new Set(),
  filterCategory: '',
  showEnded: true,
};

const $ = (id) => document.getElementById(id);

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private-mode browsers refuse storage. Decisions just do not persist;
    // the tool still works, so this is not worth interrupting anyone over.
  }
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- intake ----------

function show(section) {
  for (const id of ['intake', 'results', 'error']) $(id).hidden = id !== section;
}

function fail(message) {
  $('error-text').textContent = message;
  show('error');
}

function ingest(csvText, { now, dayFirst = false } = {}) {
  const result = analyzeStatement(csvText, { now, dayFirst });
  if (!result.ok) {
    fail(result.error);
    return;
  }
  state.csv = csvText;
  state.now = now || new Date();
  state.dayFirst = result.schema.dayFirst;
  state.detected = result.detected;
  state.schema = result.schema;
  state.stats = result.stats;
  state.expanded = new Set();
  buildCategoryFilter();
  show('results');
  render();
}

function readFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => fail('That file could not be read.');
  reader.onload = () => ingest(String(reader.result), { now: new Date() });
  reader.readAsText(file);
}

// ---------- render ----------

function currentView() {
  const visible = state.detected.filter((s) => !state.dismissed.has(s.key));
  const { series, summary } = analyze(visible, { now: state.now });
  return { series, summary, stats: state.stats };
}

function decisionFor(s) {
  return state.decisions[s.key] || s.verdict;
}

function render() {
  const view = currentView();
  const savings = projectedSavings(view.series, state.decisions);
  const canceling = view.series.filter((s) => !s.ended && state.decisions[s.key] === 'cancel').length;

  $('stat-count').textContent = String(view.summary.activeCount);
  $('stat-count-note').textContent = view.summary.reviewCount
    ? `${view.summary.reviewCount} worth a second look`
    : 'nothing flagged';
  $('stat-monthly').textContent = money(view.summary.monthlyTotal);
  $('stat-annual').textContent = money(view.summary.annualTotal);
  $('stat-annual-note').textContent = view.summary.endedCount
    ? `${view.summary.endedCount} already stopped charging`
    : 'committed every year';
  $('stat-savings').textContent = money(savings);
  $('stat-savings').closest('.stat').dataset.zero = String(savings === 0);
  $('stat-savings').nextElementSibling.textContent = canceling
    ? `saved per year from ${canceling} cancellation${canceling === 1 ? '' : 's'}`
    : 'saved per year';

  const notice = $('notice');
  if (state.schema?.ambiguous) {
    notice.hidden = false;
    $('notice-text').textContent = state.dayFirst
      ? 'Dates in this file are ambiguous. Reading them as DD/MM/YYYY (day first).'
      : 'Dates in this file are ambiguous. Reading them as MM/DD/YYYY (month first).';
  } else {
    notice.hidden = true;
  }

  const rows = view.series.filter((s) => {
    if (state.filterCategory && s.category !== state.filterCategory) return false;
    if (!state.showEnded && s.ended) return false;
    return true;
  });

  const list = $('list');
  if (rows.length === 0) {
    list.innerHTML = '<li class="empty">No recurring charges match this filter.</li>';
  } else {
    list.innerHTML = rows.map(rowHtml).join('');
  }

  const dismissedCount = state.dismissed.size;
  $('footnote').textContent =
    `Read ${state.stats.transactions} transactions across ${state.stats.spanDays} days. ` +
    `${view.series.length} recurring charges found` +
    (dismissedCount ? `, ${dismissedCount} dismissed by you.` : '.');
}

function rowHtml(s) {
  const decision = decisionFor(s);
  const expanded = state.expanded.has(s.key);
  const flags = s.flags
    .map((f) => `<span class="flag" data-sev="${f.severity}">${esc(f.label)}</span>`)
    .join('');

  const next = s.ended
    ? `Last charged ${fmtDate(s.lastSeen)}`
    : `Next around ${fmtDate(s.nextExpected)}`;

  return `
<li class="row" data-key="${esc(s.key)}" data-decision="${decision}" data-ended="${s.ended}">
  <div class="row-head" data-act="expand" role="button" tabindex="0"
       aria-expanded="${expanded}" aria-label="Details for ${esc(s.name)}">
    <div class="row-id">
      <div class="row-name">${esc(s.name)} <span class="chip">${esc(s.category)}</span></div>
      <div class="row-meta">${esc(s.cadenceLabel)} · ${s.count} charges · ${next}</div>
      ${flags ? `<div class="flags">${flags}</div>` : ''}
    </div>
    ${sparkline(s)}
    <div class="row-money">
      <div class="row-amount">${money(s.currentAmount)}</div>
      <div class="row-annual">${money(s.annualCost)}/yr</div>
    </div>
    ${decideHtml(s, decision)}
    <button type="button" class="dismiss" data-act="dismiss"
            aria-label="Not a subscription — remove ${esc(s.name)}" title="Not a subscription">&times;</button>
  </div>
  <div class="detail" ${expanded ? '' : 'hidden'}>
    ${s.flags.length ? `<div><h3>Why it is here</h3><ul class="why">${s.flags
      .map((f) => `<li><strong>${esc(f.label)}.</strong> ${esc(f.detail)}</li>`)
      .join('')}</ul></div>` : ''}
    <div>
      <h3>Every charge we matched (${s.count})</h3>
      ${historyHtml(s)}
    </div>
    <div><h3>Confidence</h3><p class="why">${Math.round(s.confidence * 100)}% — based on ${s.count} charges arriving about every ${s.medianInterval} days${s.variableAmount ? ', with an amount that moves' : ' for a steady amount'}.</p></div>
  </div>
</li>`;
}

function decideHtml(s, decision) {
  if (s.ended) return '<span class="chip">stopped</span>';
  const name = `d-${esc(s.key).replace(/\W/g, '')}`;
  return `<fieldset class="decide" data-act="decide">
    ${['keep', 'review', 'cancel']
      .map((v) => {
        const id = `${name}-${v}`;
        return `<input type="radio" id="${id}" name="${name}" value="${v}" ${decision === v ? 'checked' : ''}>
                <label for="${id}" data-v="${v}">${v[0].toUpperCase()}${v.slice(1)}</label>`;
      })
      .join('')}
  </fieldset>`;
}

function historyHtml(s) {
  const rows = [...s.occurrences]
    .reverse()
    .map((o, i, arr) => {
      const prev = arr[i + 1];
      const up = prev && o.amount > prev.amount + 0.005;
      return `<tr>
        <td>${fmtDate(o.date)}</td>
        <td class="${up ? 'up' : ''}">${money(o.amount)}${up ? ' ▲' : ''}</td>
        <td>${esc(o.description)}</td>
      </tr>`;
    })
    .join('');
  return `<table class="history"><thead><tr><th>Date</th><th>Amount</th><th>As it appears on your statement</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** Charge history at a glance: no axes, no grid — the amount is labelled beside it. */
function sparkline(s) {
  const amounts = s.occurrences.map((o) => o.amount);
  const w = 90;
  const h = 26;
  if (amounts.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;

  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const span = max - min || 1;
  const pad = 3;
  const pts = amounts.map((a, i) => {
    const x = (i / (amounts.length - 1)) * (w - 2 * pad) + pad;
    const y = h - pad - ((a - min) / span) * (h - 2 * pad);
    return [x, y];
  });

  const rose = s.currentAmount > s.firstAmount * 1.02;
  const stroke = rose ? 'var(--warn)' : 'var(--accent-deep)';
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];

  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img"
    aria-label="${s.count} charges from ${money(s.firstAmount)} to ${money(s.currentAmount)}">
    <path d="${path}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.4" fill="${stroke}"/>
  </svg>`;
}

function buildCategoryFilter() {
  const cats = [...new Set(state.detected.map((s) => s.category))].sort();
  const select = $('filter-category');
  select.innerHTML =
    '<option value="">All categories</option>' +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  select.value = '';
  state.filterCategory = '';
}

// ---------- exports ----------

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- wiring ----------

const dropzone = $('dropzone');
const fileInput = $('file');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => readFile(fileInput.files[0]));

for (const type of ['dragenter', 'dragover']) {
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-over');
  });
}
for (const type of ['dragleave', 'drop']) {
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-over');
  });
}
dropzone.addEventListener('drop', (e) => readFile(e.dataTransfer?.files?.[0]));

$('load-sample').addEventListener('click', async () => {
  // Imported as a module rather than fetched, so the page can keep
  // connect-src 'none' and make "nothing leaves this browser" enforceable.
  const { SAMPLE_CSV, SAMPLE_AS_OF } = await import('./sample-statement.js');
  ingest(SAMPLE_CSV, { now: new Date(`${SAMPLE_AS_OF}T00:00:00Z`) });
});

$('error-back').addEventListener('click', () => show('intake'));
$('reset').addEventListener('click', () => {
  fileInput.value = '';
  show('intake');
});

$('flip-dates').addEventListener('click', () => {
  ingest(state.csv, { now: state.now, dayFirst: !state.dayFirst });
});

$('filter-category').addEventListener('change', (e) => {
  state.filterCategory = e.target.value;
  render();
});
$('filter-ended').addEventListener('change', (e) => {
  state.showEnded = e.target.checked;
  render();
});

$('export-md').addEventListener('click', () => {
  download('subscription-action-plan.md', toMarkdown(currentView(), state.decisions, { now: state.now }), 'text/markdown');
});
$('export-csv').addEventListener('click', () => {
  download('subscriptions.csv', toCsv(currentView(), state.decisions), 'text/csv');
});

$('list').addEventListener('change', (e) => {
  const input = e.target.closest('input[type="radio"]');
  if (!input) return;
  const key = input.closest('.row')?.dataset.key;
  if (!key) return;
  state.decisions[key] = input.value;
  save(DECISIONS_KEY, state.decisions);
  render();
});

$('list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const key = row.dataset.key;

  if (e.target.closest('[data-act="dismiss"]')) {
    e.stopPropagation();
    state.dismissed.add(key);
    save(DISMISSED_KEY, [...state.dismissed]);
    render();
    return;
  }
  // The decision control lives inside the header; clicking it must not also
  // toggle the panel open.
  if (e.target.closest('[data-act="decide"]')) return;

  if (e.target.closest('[data-act="expand"]')) {
    if (state.expanded.has(key)) state.expanded.delete(key);
    else state.expanded.add(key);
    render();
  }
});

$('list').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const head = e.target.closest('[data-act="expand"]');
  if (!head) return;
  e.preventDefault();
  head.click();
});
