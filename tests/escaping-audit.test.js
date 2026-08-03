// tests/escaping-audit.test.js
//
// Names, descriptions and action-taken text written on other people's
// machines are rendered into innerHTML in the three tools that sync a shared
// JSON ledger (comments-hub.html, product-brain.html, pid-tag-register.html).
// Escaping (escHtml/escAttr, and jsEsc for ids embedded in inline JS event
// handlers) exists throughout, but has never been checked systematically.
// This is that check, structured as a linting test with an explicit,
// specific allow-list — so a new unescaped interpolation of ledger data
// cannot slip in unnoticed.
//
// WHAT THIS DOES:
//   Check A — scans every `X.innerHTML = ...;` statement in the three tools'
//   <script> bodies for direct string-concatenation of a known ledger
//   free-text field (description, title, name, ...) that is NOT passed
//   through escHtml(...) or escAttr(...).
//   Check B — scans every inline event-handler attribute (onclick=/onchange=
//   /onfocus=/oninput=) for a record `.id` interpolated into the handler's
//   JS-string argument that is NOT passed through escAttr(...) or jsEsc(...).
//   jsEsc matters here for a reason escAttr alone does not cover: HTML entity
//   decoding happens when the browser builds the attribute value, BEFORE
//   that value is compiled as the handler's JS source — so HTML-escaping a
//   quote (escAttr) does not stop it from re-appearing as a raw quote in the
//   JS string and breaking out of it. Only backslash-escaping (jsEsc) does.
//
// WHAT THIS DOES NOT COVER (be clear-eyed about this — a pass here is not a
// proof the tools are safe against every injection shape):
//   - Template-literal (`...${x}...`) interpolation. The three tools
//     exclusively use string concatenation (`'...' + x + '...'`) for
//     innerHTML today; if that changes, this test's statement scanner (which
//     looks for `+`-adjacent field access) will not see template-literal
//     interpolations and must be extended.
//   - Any escaping bug inside a field this test doesn't track (see
//     LEDGER_TEXT_FIELDS below) — the field list is curated from a manual
//     read of all ~95 innerHTML call sites across the three files at the
//     time this test was written, not derived mechanically from the ledger
//     schema.
//   - Values that flow through several variables before reaching innerHTML
//     (e.g. assigned to a local, transformed, then concatenated several
//     lines later under a different name). The scanner only sees direct
//     `+ record.field` concatenation within one statement.
//   - Non-`.id` identifiers used unescaped in event-handler JS strings
//     (indexes, fixed enum values, list keys) — those are not ledger free
//     text and are out of scope for this audit.
//   - Actual browser execution. This is a static text scan; it cannot run
//     the HTML/DOM/File System Access API. See docs/superpowers/plans and
//     the hardening report for what remains unverified without a browser.
//
// Pragmatic by design: this is a regex/text scan, not a real JS/HTML parser.
// It is deliberately scoped tight (concatenation only, curated field list)
// to keep false positives near zero so it stays trustworthy as a regression
// gate, at the cost of not catching every conceivable shape of the bug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = path.join(__dirname, '..', 'tools-src');

// The three tools that sync a shared JSON ledger through a company-drive
// folder — the threat model this audit exists for. The other tools-src
// files (hydrosizer, naming-validator, schedule-sync, steelwork-checker)
// don't share a ledger with other users and are out of scope.
const AUDITED_FILES = ['comments-hub.html', 'product-brain.html', 'pid-tag-register.html'];

// Free-text fields from the shared ledgers (comments, products, decisions,
// documents, families, presence, intake rows) that a colleague — or a
// hand-edit, or a corrupted sync — can put arbitrary text into, and which
// these tools render into innerHTML. Curated from a manual read of every
// innerHTML call site in the three audited files.
const LEDGER_TEXT_FIELDS = [
  'name', 'description', 'title', 'decision', 'reasoning', 'category', 'source',
  'raisedBy', 'actionTaken', 'closedBy', 'madeBy', 'recordedBy', 'editedBy',
  'caption', 'projectTag', 'docType', 'message', 'file', 'filePath', 'who',
  'dateRaised', 'dateClosed', 'pidRevision', 'type', 'sheetRefs', 'modelRef',
  'filename', 'error',
  // pid-tag-register.html's own register/ledger fields (tags, PAC/FC codes,
  // descriptions, drawing names, revisions) — found to need the same
  // treatment during the manual audit that accompanied this test.
  'tag', 'pac', 'fc', 'desc', 'drawing', 'revision',
];

// ── Allow-list of deliberate exceptions ─────────────────────────────────
// Each entry names the exact file and the field it concerns, with a reason.
// Specific, not a blanket file-level exclusion — see the plan's requirement
// that the allow-list "must be specific, not ignore this file".
//
// (Empty at the time of writing: the manual audit that accompanied this test
// found every current ledger-text interpolation already passing through
// escHtml/escAttr, and the two real gaps found — accUrl reaching href/
// window.open without a scheme check, and record ids reaching inline event
// handlers without JS-string escaping — were fixed in source rather than
// allow-listed. See docs/superpowers/HARDENING-2026-08-03.md /
// .superpowers/sdd/hardening-hostile-report.md for what was fixed.)
const ALLOWLIST_TEXT_FIELDS = new Set([
  // 'comments-hub.html:someField' — reason.
]);

const ALLOWLIST_ID_HANDLERS = new Set([
  // 'file.html:1234' — reason.
]);

function readTool(filename) {
  return fs.readFileSync(path.join(TOOLS_DIR, filename), 'utf8');
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// ── A minimal, deliberately-narrow JS "skip span" scanner ───────────────
// Advances past whatever starts at src[i] if it is a string ('...'/"..."/
// `...`) or a regex literal (/.../flags), returning the index just past it,
// or null if src[i] doesn't start one of those. Recognising regex literals
// matters: an earlier version of this scanner tracked only string quotes,
// so a character-class regex like /[&<>"']/g (which is exactly what
// escHtml's OWN implementation uses) was misread as real code — the `[`,
// `{`, `(` inside it corrupted the paren-depth count and merged unrelated
// statements together, producing false positives far from the actual match.
// Regex-vs-division is undecidable in general without a real parser; this
// uses the standard practical heuristic (the previous significant token is
// an operator/punctuator/keyword, never an identifier or closing bracket)
// and is restricted to a single line, which covers every regex literal
// actually used in these three files.
function skipStringOrRegex(src, i) {
  const ch = src[i];
  if (ch === '"' || ch === "'" || ch === '`') {
    let j = i + 1;
    for (; j < src.length; j++) {
      if (src[j] === '\\') { j++; continue; }
      if (src[j] === ch) return j + 1;
    }
    return src.length;
  }
  if (ch === '/' && src[i + 1] !== '/' && src[i + 1] !== '*') {
    let k = i - 1;
    while (k >= 0 && /\s/.test(src[k])) k--;
    const prev = k >= 0 ? src[k] : '';
    const regexContext = prev === '' || '([{,;:=!&|?+-*%<>^~'.includes(prev) ||
      /[A-Za-z0-9_$]$/.test(src.slice(Math.max(0, k - 6), k + 1)) &&
        /\b(return|typeof|case|in|of|new|instanceof)$/.test(src.slice(Math.max(0, k - 9), k + 1));
    if (regexContext) {
      let j = i + 1;
      let inClass = false;
      for (; j < src.length && src[j] !== '\n'; j++) {
        if (src[j] === '\\') { j++; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) {
          j++;
          while (j < src.length && /[a-z]/.test(src[j])) j++;
          return j;
        }
      }
    }
  }
  return null;
}

// ── Statement extraction: bracket/string/regex-depth aware ──────────────
// Finds the full statement starting at `startIdx` (the position of
// `.innerHTML =`), scanning forward tracking paren/bracket/brace depth,
// string state and regex literals, so a `;` or bracket inside a string or
// regex literal never confuses the statement boundary. Capped at 8000 chars
// as a backstop — no legitimate single statement in these files approaches
// that, so hitting the cap means the scanner lost the plot and it's better
// to under-scan than to merge in unrelated code from far below.
const MAX_STATEMENT_CHARS = 8000;
function extractStatement(src, startIdx) {
  let i = startIdx;
  let depth = 0;
  for (; i < src.length && i - startIdx < MAX_STATEMENT_CHARS; i++) {
    const skip = skipStringOrRegex(src, i);
    if (skip !== null) { i = skip - 1; continue; }
    const ch = src[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { if (depth > 0) depth--; }
    else if (ch === ';' && depth <= 0) return src.slice(startIdx, i + 1);
  }
  return src.slice(startIdx, Math.min(src.length, startIdx + MAX_STATEMENT_CHARS));
}

function findInnerHtmlStatements(src) {
  const out = [];
  const re = /\w+\.innerHTML\s*=(?!=)/g;
  let m;
  while ((m = re.exec(src))) {
    out.push({ text: extractStatement(src, m.index), index: m.index });
  }
  return out;
}

// Removes escHtml(...)/escAttr(...)/jsEsc(...) call spans (bracket-aware, so
// nested parens/commas/regexes inside the call don't confuse it), replacing
// each with a placeholder. What's left is exactly the parts of the statement
// NOT already routed through one of the escaping helpers.
function stripEscapedSpans(text) {
  let out = '';
  let i = 0;
  const callRe = /\b(escHtml|escAttr|jsEsc)\(/g;
  while (i < text.length) {
    callRe.lastIndex = i;
    const m = callRe.exec(text);
    if (!m) { out += text.slice(i); break; }
    out += text.slice(i, m.index);
    let depth = 1;
    let j = m.index + m[0].length;
    for (; j < text.length && depth > 0; j++) {
      const skip = skipStringOrRegex(text, j);
      if (skip !== null) { j = skip - 1; continue; }
      if (text[j] === '(') depth++;
      else if (text[j] === ')') depth--;
    }
    out += ' ESCAPED_CALL ';
    i = j;
  }
  return out;
}

// After a `field` match, decide whether it is really flowing into the HTML
// output (a concatenation operand: `+ x.field +`, `+ x.field)`, `+ x.field;`,
// end of string) versus merely being READ for something else in the same
// statement (a ternary condition `x.field ? ... : ...`, a function argument
// `f(x.field, ...)`, or a further method/property chain `x.field.slice(...)`
// whose eventual output — if ever unescaped — would be caught where THAT
// value is concatenated instead). This is what keeps the audit from flooding
// on ordinary logic like `(c.status === 'closed' ? ... : ...)`.
function looksLikeRawConcatenation(stripped, matchEnd) {
  let k = matchEnd;
  while (k < stripped.length && /\s/.test(stripped[k])) k++;
  // Skip an `|| 'default'` / `|| "default"` fallback and any wrapping `)`.
  while (true) {
    if (stripped.slice(k, k + 2) === '||') {
      k += 2;
      while (k < stripped.length && /\s/.test(stripped[k])) k++;
      const skip = skipStringOrRegex(stripped, k);
      if (skip !== null) { k = skip; while (k < stripped.length && /\s/.test(stripped[k])) k++; continue; }
    }
    if (stripped[k] === ')') { k++; continue; }
    break;
  }
  const next = stripped[k];
  if (next === '.' ) return false;     // further chaining — not a terminal value here
  if (next === '?' ) return false;     // ternary condition
  if (next === ',' ) return false;     // function argument
  if (next === '=' && stripped[k + 1] !== '=') return false; // assignment target (rare)
  return true;                          // '+', ';', end-of-string, ')' closing an outer expr, etc.
}

// ── Check A: ledger free-text fields concatenated raw into innerHTML ────
function auditTextEscaping(filename, src) {
  const violations = [];
  const statements = findInnerHtmlStatements(src);
  for (const stmt of statements) {
    const stripped = stripEscapedSpans(stmt.text);
    for (const field of LEDGER_TEXT_FIELDS) {
      // Only flags CONCATENATION (`+ x.field`) or template interpolation
      // (`${x.field`) — i.e. the field's value actually flowing into the
      // HTML string — not comparisons/conditions/arguments (see
      // looksLikeRawConcatenation) or method chains that terminate in an
      // escHtml/escAttr/jsEsc call already stripped above.
      const re = new RegExp('(\\+|\\$\\{)\\s*\\(?\\s*[A-Za-z_$][\\w$]*\\.' + field + '\\b', 'g');
      let m;
      while ((m = re.exec(stripped))) {
        if (!looksLikeRawConcatenation(stripped, re.lastIndex)) continue;
        const key = filename + ':' + field;
        if (ALLOWLIST_TEXT_FIELDS.has(key)) continue;
        violations.push({
          file: filename,
          line: lineOf(src, stmt.index),
          field,
          snippet: stmt.text.slice(0, 140).replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }
  return violations;
}

// ── Check B: record ids in inline event-handler JS strings ──────────────
function auditIdHandlerEscaping(filename, src) {
  const violations = [];
  const lines = src.split('\n');
  const idRe = /([A-Za-z_$][\w$]*)\.id\b/g;
  lines.forEach((line, idx) => {
    if (!/on(click|change|focus|input)=/.test(line)) return;
    idRe.lastIndex = 0;
    let m;
    while ((m = idRe.exec(line))) {
      const before = line.slice(Math.max(0, m.index - 14), m.index);
      if (/(escAttr|jsEsc)\(\s*(String\()?\s*$/.test(before)) continue;
      const key = filename + ':' + (idx + 1);
      if (ALLOWLIST_ID_HANDLERS.has(key)) continue;
      violations.push({ file: filename, line: idx + 1, snippet: line.trim().slice(0, 160) });
    }
  });
  return violations;
}

function formatViolations(violations) {
  return violations.map(v => `  ${v.file}:${v.line} — ${v.snippet}`).join('\n');
}

test('escaping audit: ledger free-text fields reach innerHTML only through escHtml/escAttr', () => {
  const all = [];
  for (const filename of AUDITED_FILES) {
    const src = readTool(filename);
    all.push(...auditTextEscaping(filename, src));
  }
  assert.equal(all.length, 0,
    `Unescaped ledger text field(s) reaching innerHTML:\n${formatViolations(all)}`);
});

test('escaping audit: record ids in inline event handlers pass through escAttr/jsEsc', () => {
  const all = [];
  for (const filename of AUDITED_FILES) {
    const src = readTool(filename);
    all.push(...auditIdHandlerEscaping(filename, src));
  }
  assert.equal(all.length, 0,
    `Record id interpolated into an inline event handler without escAttr/jsEsc:\n${formatViolations(all)}`);
});

// ── Self-test: prove the detector actually has teeth ─────────────────────
// If these ever pass, the audit above is not testing what it claims to.
test('self-test: the text-field detector catches an unescaped interpolation', () => {
  const hostile = "function f(c){ wrap.innerHTML = '<div>' + c.description + '</div>'; }";
  const violations = auditTextEscaping('fixture.html', hostile);
  assert.ok(violations.some(v => v.field === 'description'),
    'detector failed to flag a raw c.description concatenated into innerHTML');
});

test('self-test: the text-field detector catches an unescaped template-literal interpolation', () => {
  const hostile = 'function f(t){ tbody.innerHTML = `<td>${t.desc}</td>`; }';
  const violations = auditTextEscaping('fixture.html', hostile);
  assert.ok(violations.some(v => v.field === 'desc'),
    'detector failed to flag a raw ${t.desc} template-literal interpolation');
});

test('self-test: the statement scanner is not confused by a regex literal containing brackets', () => {
  // This is, almost verbatim, the bug that produced false positives during
  // this test's development: a character-class regex (as used inside
  // escHtml's own implementation) contains [, ], (, ) — read naively as real
  // code, it corrupts paren-depth tracking and merges unrelated statements
  // together. A raw c.description AFTER such a regex, in a DIFFERENT
  // statement, must not be attributed to the innerHTML statement above it.
  const src = [
    "function esc(s){ return String(s).replace(/[&<>\"']/g, c => c); }",
    "function f(c){ wrap.innerHTML = '<div>' + esc(c.description) + '</div>'; }",
    "function g(c){ toast('note: ' + c.description); }",
  ].join('\n');
  const violations = auditTextEscaping('fixture.html', src);
  assert.equal(violations.length, 0,
    'a regex literal on an earlier line caused an unrelated raw concatenation to be misattributed');
});

test('self-test: the text-field detector does not flag properly escaped text', () => {
  const safe = "function f(c){ wrap.innerHTML = '<div>' + escHtml(c.description || '') + '</div>'; }";
  const violations = auditTextEscaping('fixture.html', safe);
  assert.equal(violations.length, 0, 'detector false-flagged an escHtml-wrapped interpolation');
});

test('self-test: the text-field detector does not false-flag a status comparison', () => {
  // c.status is not a free-text field (fixed enum) and this is a comparison,
  // not a concatenation — real code does this constantly (e.g. building a
  // ternary) and it must not trip the audit.
  const safe = "function f(c){ wrap.innerHTML = c.status === 'closed' ? 'x' : 'y'; }";
  const violations = auditTextEscaping('fixture.html', safe);
  assert.equal(violations.length, 0, 'detector false-flagged a comparison, not a concatenation');
});

test('self-test: the text-field detector does not false-flag a ternary condition or a safe wrapper argument', () => {
  // This is, almost verbatim, a real false positive hit during this test's
  // development (comments-hub.html detailPanelHtml): c.actionTaken is used
  // once as a ternary CONDITION and once as an ARGUMENT to a local helper
  // that escapes internally — neither is the field's value landing raw in
  // HTML, and the audit must not flag either.
  const safe = "function f(c, field){ wrap.innerHTML = x + (c.actionTaken ? field('Action taken', c.actionTaken, true) : ''); }";
  const violations = auditTextEscaping('fixture.html', safe);
  assert.equal(violations.length, 0,
    'detector false-flagged a ternary condition / function-argument use of a ledger field');
});

test('self-test: the id-handler detector catches a raw id in onclick', () => {
  const hostile = 'wrap.innerHTML = \'<button onclick="del(\\\'\' + c.id + \'\\\')">x</button>\';';
  const violations = auditIdHandlerEscaping('fixture.html', hostile);
  assert.equal(violations.length, 1, 'detector failed to flag a raw c.id in an onclick handler');
});

test('self-test: the id-handler detector does not flag a jsEsc-wrapped id', () => {
  const safe = 'wrap.innerHTML = \'<button onclick="del(\\\'\' + jsEsc(c.id) + \'\\\')">x</button>\';';
  const violations = auditIdHandlerEscaping('fixture.html', safe);
  assert.equal(violations.length, 0, 'detector false-flagged a jsEsc-wrapped id');
});

test('self-test: the id-handler detector does not flag an escAttr-wrapped id', () => {
  const safe = 'wrap.innerHTML = \'<button onclick="del(\\\'\' + escAttr(c.id) + \'\\\')">x</button>\';';
  const violations = auditIdHandlerEscaping('fixture.html', safe);
  assert.equal(violations.length, 0, 'detector false-flagged an escAttr-wrapped id');
});
