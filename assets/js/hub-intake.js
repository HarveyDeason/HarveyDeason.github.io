// assets/js/hub-intake.js
// Builds the workbook model for the Comments Hub's site-feedback intake
// template: a pre-scoped sheet that gets emailed out, filled in offline by
// site teams who can't reach the shared drive, and imported back through a
// review table. This module parses/produces only the hub's own intake file
// — generated logs like "Master Log.xlsx" are never read back, and that
// principle must not erode.
//
// Pure and node-testable: no DOM, no File System Access API, and ExcelJS is
// never imported here — later stages (rendering, parsing) receive it as a
// parameter, matching the convention in xlsx-render.js.
//
// The hidden Lists sheet carries product IDs alongside names. A returned
// template can then be matched on stable IDs instead of fuzzy name-matching,
// which only survives as a fallback for hand-typed rows.

export const INTAKE_TEMPLATE_VERSION = 1;

// affectedTypes[] is multi-valued on a comment, but a single Excel dropdown
// can only express one choice — so it is split into three Yes/No columns
// here and recombined into affectedTypes[] again on import (Task 3).
export const INTAKE_COLUMNS = [
  { key: 'product', header: 'Product', width: 28 },
  { key: 'affPid', header: 'Affects P&ID', width: 14 },
  { key: 'affModel', header: 'Affects Model', width: 14 },
  { key: 'affSheets', header: 'Affects Drawing Sheets', width: 18 },
  { key: 'category', header: 'Category', width: 22 },
  { key: 'source', header: 'Source', width: 18 },
  { key: 'dateRaised', header: 'Date Raised', width: 14 },
  { key: 'raisedBy', header: 'Raised By', width: 20 },
  { key: 'priority', header: 'Priority', width: 12 },
  { key: 'description', header: 'Description', width: 50 },
];

const PRIORITIES = ['low', 'medium', 'high'];
const YES_NO = ['Yes', 'No'];

// Pre-validated blank rows given to site teams to fill in — enough headroom
// for a batch of comments without them needing to extend the sheet (which
// would drop the dropdown validation on the new rows).
const BLANK_ROW_COUNT = 100;

export function buildIntakeTemplateModel(state, productIds, nowIso) {
  const products = (state.products || []).filter(p => (productIds || []).includes(p.id));

  const prefill = products.length === 1 ? { product: products[0].name } : {};

  const validations = [
    { columnKey: 'product', listRef: 'products' },
    { columnKey: 'affPid', listRef: 'yesNo' },
    { columnKey: 'affModel', listRef: 'yesNo' },
    { columnKey: 'affSheets', listRef: 'yesNo' },
    { columnKey: 'category', listRef: 'categories' },
    { columnKey: 'source', listRef: 'sources' },
    { columnKey: 'priority', listRef: 'priorities' },
  ];

  // Human-readable reference lines for the site team: which drawings are
  // already linked to each scoped product, so they know what they're
  // commenting against without having to look it up elsewhere.
  const rows = products.map(p => {
    const drawings = (p.pidDrawings || []).join(', ');
    return `${p.name}: ${drawings || '(no linked drawings)'}`;
  });

  return {
    filename: 'Comment Intake Template.xlsx',
    sheets: [
      {
        name: 'Comments',
        kind: 'template',
        columns: INTAKE_COLUMNS,
        prefill,
        rowCount: BLANK_ROW_COUNT,
        validations,
      },
      {
        name: 'Lists',
        kind: 'lists',
        hidden: true,
        meta: { templateVersion: INTAKE_TEMPLATE_VERSION, generatedOn: nowIso },
        lists: {
          products: products.map(p => ({ id: p.id, name: p.name })),
          categories: (state.lists && state.lists.categories) || [],
          sources: (state.lists && state.lists.sources) || [],
          priorities: PRIORITIES.slice(),
          yesNo: YES_NO.slice(),
        },
        rows,
      },
    ],
  };
}

// --- parseIntakeWorkbook: reading a returned intake sheet back in ---
//
// This is the other half of the pipeline started by buildIntakeTemplateModel
// above: a site team fills in the emailed template offline, in whatever
// version of Excel they have, and emails it back. This function turns that
// *already-loaded* ExcelJS workbook into plain rows the hub can validate and
// resolve (Task 4). It stays pure — no DOM, no File System Access, and
// ExcelJS is never imported here, only received via the `workbook` argument,
// because the caller owns file I/O (see module header).
//
// Governing principle (must not erode): the hub parses ONLY its own intake
// file, produced by buildIntakeTemplateModel/renderWorkbook. The generated
// logs ("Master Log.xlsx", per-product comment logs) are disposable outputs
// and are never read back — there is no code path here, or anywhere else in
// this module, that opens them.

// How many leading rows to scan for the header. A site team may paste a
// title, a logo caption, or leave a blank row above the real header — but
// nobody pastes more than a handful of rows above their data.
const HEADER_SCAN_ROWS = 10;

// A row counts as "the header" once it matches at least this many known
// column headers — one match could be a coincidence (a stray cell that says
// "Category"), two is enough to be confident without requiring an exact,
// fragile match against every column (site teams delete columns they don't
// need).
const MIN_HEADER_MATCHES = 2;

const AFFECTED_TYPE_LABELS = {
  affPid: 'P&ID',
  affModel: 'Model',
  affSheets: 'Drawing sheets',
};

// Truthy spellings a site team might type into a Yes/No dropdown cell once
// it's been opened, edited and re-saved by hand: the literal dropdown value,
// a single-letter shorthand, a boolean from a paste, or a checkbox-style x.
// Matched case-insensitively; anything else (including blank) means no.
const TRUTHY_YES_NO = new Set(['yes', 'y', 'true', 'x']);

function normaliseHeader(text) {
  return String(text == null ? '' : text).trim().toLowerCase();
}

// ExcelJS cell values aren't always plain strings/numbers: a formula cell
// comes back as { formula, result }, a rich-text cell as { richText: [...] },
// and a date cell as a real Date object. Coerce whatever we get into a
// trimmed string so downstream matching/parsing never has to special-case
// cell shape again.
function cellToString(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10); // YYYY-MM-DD
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(rt => rt.text).join('');
    if ('result' in value) return cellToString(value.result);
    if ('text' in value) return String(value.text);
  }
  return String(value).trim();
}

// Excel's date epoch: serial 0 is 1899-12-30 (not 1900-01-01 — Excel's
// famous leap-year bug is baked into the format, and this offset already
// accounts for it). A cell that has actually round-tripped through an xlsx
// file commonly comes back as a plain number rather than a Date object, even
// when it was written/rendered as a date — this is the shape real returned
// templates take, which cellToString()/Date handling above never sees.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A plausible date serial: 1 is 1899-12-31, 100000 is far beyond any
// realistic Date Raised (year ~2173). Anything outside this range is not a
// date that was ever meant to land in this column — treat it as unparseable
// rather than inventing a nonsense date.
const MIN_DATE_SERIAL = 1;
const MAX_DATE_SERIAL = 100000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isoFromUtcParts(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

// Coerces a raw Date Raised cell value into an ISO YYYY-MM-DD string, or ''
// if it can't be confidently parsed. Handles every shape a real returned
// intake file can carry: a JS Date (from a date-formatted cell that survived
// the round trip), an Excel serial number (the common case for a
// date-formatted cell once it's been through a save/reload), an ISO-ish
// string already, and a UK day-first string typed by hand. Deliberately does
// NOT fall back to JS's native Date parsing for strings, which reads
// ambiguous dates as US month-first and would silently swap day/month for a
// UK water-industry team.
function parseDateCell(value) {
  if (value == null) return '';

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'object') {
    if ('result' in value) return parseDateCell(value.result);
    if ('text' in value) return parseDateCell(String(value.text));
    if (Array.isArray(value.richText)) return parseDateCell(value.richText.map(rt => rt.text).join(''));
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < MIN_DATE_SERIAL || value > MAX_DATE_SERIAL) return '';
    const ms = EXCEL_EPOCH_MS + Math.round(value) * MS_PER_DAY;
    const d = new Date(ms);
    return isoFromUtcParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  const text = String(value).trim();
  if (!text) return '';

  // Already ISO-ish (YYYY-MM-DD, optionally with a time component tacked on).
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return isoFromUtcParts(Number(y), Number(m), Number(d));
  }

  // UK day-first, e.g. "29/07/2026" or "29-07-2026". Day first is not
  // optional here: reading it month-first would silently corrupt the date
  // rather than fail loudly, which is worse.
  const ukMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ukMatch) {
    const [, dd, mm, yyyy] = ukMatch;
    const day = Number(dd);
    const month = Number(mm);
    const year = Number(yyyy);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return isoFromUtcParts(year, month, day);
    }
    return '';
  }

  return '';
}

function isYes(value) {
  return TRUTHY_YES_NO.has(normaliseHeader(value));
}

// Finds the header row within the first HEADER_SCAN_ROWS rows by matching
// cell text (normalised) against known column headers — position-independent
// so a reordered or trimmed-down template still imports. Returns
// { rowNumber, indexByKey } or null if nothing looks like a header.
function findHeaderRow(ws) {
  const headerByNormalised = new Map(INTAKE_COLUMNS.map(c => [normaliseHeader(c.header), c.key]));
  const maxRow = Math.min(ws.rowCount || 0, HEADER_SCAN_ROWS);
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    const indexByKey = {};
    let matches = 0;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const key = headerByNormalised.get(normaliseHeader(cellToString(cell.value)));
      if (key) {
        indexByKey[key] = colNumber;
        matches += 1;
      }
    });
    if (matches >= MIN_HEADER_MATCHES) return { rowNumber: r, indexByKey };
  }
  return null;
}

function findDataSheet(workbook) {
  const byName = workbook.getWorksheet('Comments');
  if (byName) return byName;
  // Fallback for a hand-rebuilt sheet that got renamed: the first sheet the
  // site team can actually see (the Lists sheet is veryHidden, so it's
  // naturally excluded).
  return (workbook.worksheets || []).find(ws => ws.state !== 'hidden' && ws.state !== 'veryHidden') || null;
}

// The Lists sheet is optional on the way back in — a site team could in
// theory rebuild the Comments sheet by hand without it. When present, it's
// where exact product-ID matching and template-version drift detection come
// from (see module header); when absent, we degrade gracefully rather than
// throwing, since Task 4's resolution can still fall back to name matching.
function parseListsSheet(workbook) {
  const ws = workbook.getWorksheet('Lists');
  if (!ws) return { templateVersion: undefined, products: [] };

  // products live in columns 1 (name) and 2 (id), one pair per row, no
  // header — see xlsx-render.js's listColumnLetters() for why.
  const products = [];
  const maxRow = ws.rowCount || 0;
  for (let r = 1; r <= maxRow; r++) {
    const name = cellToString(ws.getCell(r, 1).value);
    const id = cellToString(ws.getCell(r, 2).value);
    if (!name && !id) continue;
    products.push({ id, name });
  }

  // Metadata is label/value pairs in columns 8/9, found by LABEL not row
  // number so new fields don't shift templateVersion out from under a fixed
  // row (see xlsx-render.js).
  let templateVersion;
  const META_LABEL_COL = 8;
  const META_VALUE_COL = 9;
  for (let r = 1; r <= maxRow; r++) {
    const label = cellToString(ws.getCell(r, META_LABEL_COL).value);
    if (label === 'templateVersion') {
      const raw = cellToString(ws.getCell(r, META_VALUE_COL).value);
      const num = Number(raw);
      templateVersion = Number.isNaN(num) ? raw : num;
      break;
    }
  }

  return { templateVersion, products };
}

export function parseIntakeWorkbook(workbook) {
  const ws = findDataSheet(workbook);
  if (!ws) throw new Error('No usable sheet found to read a header row from');

  const header = findHeaderRow(ws);
  if (!header) throw new Error('Could not find a recognisable header row in the returned sheet');

  const rows = [];
  const maxRow = ws.rowCount || 0;
  for (let r = header.rowNumber + 1; r <= maxRow; r++) {
    const row = ws.getRow(r);

    // A blank row (nothing in any mapped column) is normal — site teams
    // leave gaps between entries — and is skipped silently, not an error.
    const values = {};
    let hasContent = false;
    for (const col of INTAKE_COLUMNS) {
      const colNumber = header.indexByKey[col.key];
      const rawValue = colNumber ? row.getCell(colNumber).value : null;
      const text = col.key === 'dateRaised' ? parseDateCell(rawValue) : cellToString(rawValue);
      values[col.key] = text;
      if (colNumber && cellToString(rawValue)) hasContent = true;
    }
    if (!hasContent) continue;

    const affectedTypes = ['affPid', 'affModel', 'affSheets']
      .filter(key => isYes(values[key]))
      .map(key => AFFECTED_TYPE_LABELS[key]);

    rows.push({
      product: values.product,
      affectedTypes,
      category: values.category,
      source: values.source,
      dateRaised: values.dateRaised,
      raisedBy: values.raisedBy,
      priority: values.priority,
      description: values.description,
    });
  }

  const { templateVersion, products } = parseListsSheet(workbook);
  return { templateVersion, products, rows };
}
