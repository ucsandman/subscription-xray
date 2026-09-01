// RFC4180-ish CSV reader that survives real bank exports: BOM, CRLF, quoted
// fields with embedded commas/newlines, doubled quotes, and semicolon/tab
// delimiters (common in EU exports).

const DELIMITERS = [',', ';', '\t', '|'];

/** Pick the delimiter that yields the most consistent column count. */
export function sniffDelimiter(text) {
  const sample = text.slice(0, 8192);
  let best = ',';
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const rows = readRows(sample, d).filter((r) => r.length > 1);
    if (rows.length === 0) continue;
    const counts = rows.map((r) => r.length);
    const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)];
    const agreeing = counts.filter((c) => c === mode).length;
    // Reward many columns that agree; a wrong delimiter yields 1 column.
    const score = agreeing * mode;
    if (mode > 1 && score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function readRows(text, delimiter) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else if (ch === '\r') {
      // swallow; the \n that follows ends the row
    } else {
      field += ch;
    }
  }

  row.push(field);
  rows.push(row);
  return rows;
}

/**
 * Parse CSV text into trimmed string cells.
 * Rows that are entirely empty (blank lines, trailing newline) are dropped.
 */
export function parseCsv(text, delimiter) {
  if (typeof text !== 'string' || text.trim() === '') return [];
  const clean = text.replace(/^﻿/, '');
  const d = delimiter || sniffDelimiter(clean);
  return readRows(clean, d)
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell !== ''));
}
