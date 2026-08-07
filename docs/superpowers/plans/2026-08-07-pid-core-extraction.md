# P&ID Tag Extraction Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the P&ID Tag Register's tag-extraction logic into a tracked, tested `assets/js/pid-core.js` without changing what it produces.

**Architecture:** The functions move; the Wessex Water lookup tables do not. `extractTags` takes the tables as an argument, so the algorithm becomes public and testable while DS310 reference data stays inside the encrypted tool. Behaviour is pinned by golden fixtures captured from the current code *before* any edit.

**Tech Stack:** Vanilla ES modules, `node --test`, the in-app browser for capture and verification.

**Spec:** `docs/superpowers/specs/2026-08-07-pid-core-extraction-design.md`

## Global Constraints

- `assets/js/` is served **publicly**. No DS310 reference data — no real FC codes with descriptions, no PAC table — may be committed to `assets/js/`, `tests/`, or any fixture. Tests and fixtures use fictional lookups only.
- `assets/js/pid-core.js` stays **pure**: no DOM, no File System Access, no globals. It must run under `node --test`.
- **No pure function may throw on any input.** Degraded output is fine; an exception is not. This matches `hub-core.js`, `hub-sync.js` and `pid-comments.js`.
- `tools-src/` is **gitignored** — commit tool-side changes with `git commit --allow-empty`. Never run `lock-tools.mjs`; the owner does that.
- Baseline before starting: **577 tests, 575 passing, 0 failing, 2 skipped.**

---

### Task 1: Pin current behaviour with golden fixtures

Nothing may be extracted until the current behaviour is captured. There are no tests today, so these fixtures are the only thing that can prove the move was faithful.

**Files:**
- Create: `tests/fixtures/pid-tag-corpus.js`
- Create: `tests/fixtures/pid-tag-golden.json`

**Interfaces:**
- Produces: `FIXTURE_LOOKUPS` and `CORPUS` (consumed by Task 2's golden test).

- [ ] **Step 1: Write the corpus.** Create `tests/fixtures/pid-tag-corpus.js`. Every entry targets a specific branch of the current `extractTagsFromText`. `FIXTURE_LOOKUPS` is invented — `XX`/`YY` are not DS310 codes. `PP` and `SS` appear only because they are in the pipe-material list the `likelyLineNum` rule checks.

```js
// tests/fixtures/pid-tag-corpus.js
// Fictional lookups: DS310 reference data must never reach a committed file
// (assets/js/ and tests/ are public; the real tables stay in the encrypted tool).
export const FIXTURE_LOOKUPS = {
  fc: { XX: 'widget', YY: 'gadget', PP: 'pipework', SS: 'pipework' },
  fcDescriptions: { XX: 'Example Widget', YY: 'Example Gadget' },
  pac: { 21: 'Example Area' },
};

// Each case names the branch it exists to pin.
export const CORPUS = [
  { name: 'plain exact tag', text: '21-XX-1001' },
  { name: 'en dash normalised', text: '21–XX–1002' },
  { name: 'em dash normalised', text: '21—XX—1003' },
  { name: 'figure dash and horizontal bar', text: '21‒XX‒1004 21―YY―1005' },
  { name: 'double hyphen collapsed', text: '21--XX--1006' },
  { name: 'lower case input', text: '21-xx-1007' },
  { name: 'rejoin: fc and id split by space', text: '21-XX 1008' },
  { name: 'rejoin: A-E suffix split off', text: '21-XX-1009 A' },
  { name: 'rejoin: spaces around both hyphens', text: '21 - XX - 1010' },
  { name: 'likelyLineNum: single-digit pac + pipe material', text: '1-PP-1011' },
  { name: 'not a line num: two-digit pac + pipe material', text: '21-PP-1012' },
  { name: 'likelyLineNum: other pipe material', text: '9-SS-1013' },
  { name: 'fuzzy: underscore separators', text: '21_YY_1014' },
  { name: 'fuzzy: dot separators', text: '21.YY.1015' },
  { name: 'fuzzy rejected: all-digit middle group', text: '21_99_1016' },
  { name: 'dedup: same tag twice', text: '21-XX-1017 21-XX-1017' },
  { name: 'dedup: exact wins over fuzzy', text: '21-XX-1018 21_XX_1018' },
  { name: 'trailing letters on id', text: '21-XX-1019AB' },
  { name: 'unknown fc falls back to other', text: '21-ZZ-1020' },
  { name: 'no tags at all', text: 'THIS DRAWING HAS NO TAGS ON IT' },
  { name: 'empty string', text: '' },
  { name: 'realistic mixed block', text: [
      'P&ID SHEET 1 OF 3',
      'PUMP 21-XX-2001A  DUTY',
      'PUMP 21-XX-2002B  ASSIST',
      'LINE 1-PP-3001',
      'INSTR 21–YY–4001',
      '13-XX 5001',
      'NOTE: SEE 21 - YY - 6001 FOR DETAIL',
    ].join('\n') },
];
```

- [ ] **Step 2: Start the preview server and open the current tool.**

Run `preview_start` with name `site`, then navigate to `http://localhost:5050/tools-src/pid-tag-register.html`.

- [ ] **Step 3: Capture the golden output from the CURRENT function.**

The tool's main script is a classic `<script>`, so `resolveFC` is a reassignable window property. Overriding it swaps in the fictional lookups without touching the `const` tables — this is what lets the fixtures be committed. Run in the browser console:

```js
(async () => {
  const mod = await import('/tests/fixtures/pid-tag-corpus.js');
  const { FIXTURE_LOOKUPS, CORPUS } = mod;
  // Swap the lookups by replacing resolveFC, the only reader of the tables
  // inside extractTagsFromText. The const tables are untouched.
  const realResolveFC = resolveFC;
  resolveFC = function (fc) {
    return {
      cat: FIXTURE_LOOKUPS.fc[fc] || 'other',
      desc: FIXTURE_LOOKUPS.fcDescriptions[fc] || fc,
    };
  };
  const golden = {};
  try {
    for (const c of CORPUS) {
      golden[c.name] = extractTagsFromText(c.text, 'SP51', 'C');
    }
  } finally {
    resolveFC = realResolveFC;
  }
  console.log(JSON.stringify(golden));
})()
```

- [ ] **Step 4: Save the captured JSON** verbatim to `tests/fixtures/pid-tag-golden.json`, pretty-printed with 2-space indent.

- [ ] **Step 5: Sanity-check the capture before trusting it.** Confirm by reading the JSON that: `plain exact tag` produced one `confirmed` entry with `desc: 'Example Widget'` and `type: 'widget'`; `likelyLineNum: single-digit pac + pipe material` produced an entry in `review` with `isReview: true` and none in `confirmed`; `fuzzy rejected: all-digit middle group` produced nothing at all with `likelyScanPDF: true`; and `no tags at all` produced `likelyScanPDF: true`. If any of these is not so, the capture is wrong — stop and investigate rather than committing a fixture that pins the wrong behaviour.

- [ ] **Step 6: Commit.**

```bash
git add tests/fixtures/pid-tag-corpus.js tests/fixtures/pid-tag-golden.json
git commit -m "test: pin current P&ID tag-extraction behaviour with golden fixtures

Captured from the live tool before extracting anything. There are no tests
on this code today, so these fixtures are the only evidence that the move
does not change what the register produces.

Lookups are fictional — resolveFC was overridden during capture so no DS310
reference data reaches a committed file."
```

---

### Task 2: Build `pid-core.js` against the fixtures

**Files:**
- Create: `assets/js/pid-core.js`
- Create: `tests/pid-core.test.js`

**Interfaces:**
- Consumes: `FIXTURE_LOOKUPS`, `CORPUS` from Task 1; `tests/fixtures/pid-tag-golden.json`.
- Produces:
  - `extractTags(text, { drawingName, revision, lookups }) -> { confirmed, review, likelyScanPDF }`
  - `resolveFC(fc, lookups) -> { cat, desc }`
  - `normaliseTagText(text) -> string`
  - `PIPE_MATERIAL_CODES: string[]`
  - Tag shape: `{ tag, pac, fc, id, desc, drawing, revision, type, isClash, isReview }`

- [ ] **Step 1: Write the failing tests.** Create `tests/pid-core.test.js`:

```js
// tests/pid-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractTags, resolveFC, normaliseTagText, PIPE_MATERIAL_CODES } from '../assets/js/pid-core.js';
import { FIXTURE_LOOKUPS, CORPUS } from './fixtures/pid-tag-corpus.js';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/pid-tag-golden.json', import.meta.url), 'utf8'));
const L = FIXTURE_LOOKUPS;

// ── The golden comparison: the whole point of this extraction ──
// These fixtures were captured from the tool BEFORE any code moved. If one of
// these fails, the extraction changed what the register produces — which is
// the only failure mode that actually matters here.
test('golden: every corpus case reproduces the captured output exactly', () => {
  for (const c of CORPUS) {
    const actual = extractTags(c.text, { drawingName: 'SP51', revision: 'C', lookups: L });
    assert.deepEqual(actual, GOLDEN[c.name], `corpus case drifted: ${c.name}`);
  }
});

// ── resolveFC ──
test('resolveFC maps a known code to its category and description', () => {
  assert.deepEqual(resolveFC('XX', L), { cat: 'widget', desc: 'Example Widget' });
});

test('resolveFC falls back to other, and to the code as its own description', () => {
  assert.deepEqual(resolveFC('ZZ', L), { cat: 'other', desc: 'ZZ' });
  // A code that is classified but undescribed keeps its category.
  assert.deepEqual(resolveFC('PP', L), { cat: 'pipework', desc: 'PP' });
});

test('resolveFC degrades rather than throwing when lookups are missing or junk', () => {
  for (const bad of [undefined, null, 0, '', [], 'nope']) {
    assert.doesNotThrow(() => resolveFC('XX', bad));
    assert.deepEqual(resolveFC('XX', bad), { cat: 'other', desc: 'XX' });
  }
});

// ── normaliseTagText ──
test('normaliseTagText converts every dash variant and collapses doubles', () => {
  assert.equal(normaliseTagText('21–XX–1001'), '21-XX-1001');
  assert.equal(normaliseTagText('21—XX—1001'), '21-XX-1001');
  assert.equal(normaliseTagText('21‒XX‒1001'), '21-XX-1001');
  assert.equal(normaliseTagText('21―XX―1001'), '21-XX-1001');
  assert.equal(normaliseTagText('21--XX---1001'), '21-XX-1001');
});

test('normaliseTagText upper-cases, so lower-case PDF text still matches', () => {
  assert.equal(normaliseTagText('21-xx-1001'), '21-XX-1001');
});

test('normaliseTagText rejoins tags split by extracted-PDF whitespace', () => {
  // Rule 1: function code and id separated by a space.
  assert.equal(normaliseTagText('21-XX 1001'), '21-XX-1001');
  // Rule 2: a trailing parallel-plant letter split off.
  assert.equal(normaliseTagText('21-XX-1001 A'), '21-XX-1001A');
  // Rule 3: spaces around both hyphens.
  assert.equal(normaliseTagText('21 - XX - 1001'), '21-XX-1001');
});

test('normaliseTagText never throws on non-string input', () => {
  for (const bad of [undefined, null, 0, {}, [], NaN]) {
    assert.doesNotThrow(() => normaliseTagText(bad));
  }
});

// ── extractTags ──
test('extractTags splits an exact tag into its DS310 parts', () => {
  const r = extractTags('21-XX-1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 1);
  assert.deepEqual(r.confirmed[0], {
    tag: '21-XX-1001', pac: '21', fc: 'XX', id: '1001', desc: 'Example Widget',
    drawing: 'SP51', revision: 'C', type: 'widget', isClash: false, isReview: false,
  });
  assert.equal(r.review.length, 0);
  assert.equal(r.likelyScanPDF, false);
});

test('extractTags routes a likely line number to review, not confirmed', () => {
  // Single-digit process area plus a pipe-material code reads as a line
  // number rather than an asset, so it needs a human to confirm.
  const r = extractTags('1-PP-1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 0);
  assert.equal(r.review.length, 1);
  assert.equal(r.review[0].isReview, true);
});

test('extractTags keeps a two-digit process area with a pipe material as confirmed', () => {
  const r = extractTags('21-PP-1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 1);
  assert.equal(r.review.length, 0);
});

test('extractTags accepts fuzzy separators but always sends them to review', () => {
  const r = extractTags('21_YY_1001 21.YY.1002', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 0);
  assert.deepEqual(r.review.map(t => t.tag), ['21-YY-1001', '21-YY-1002']);
});

test('extractTags rejects a fuzzy match whose middle group is all digits', () => {
  // '21_99_1001' is a number range, not a tag.
  const r = extractTags('21_99_1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length + r.review.length, 0);
  assert.equal(r.likelyScanPDF, true);
});

test('extractTags de-duplicates, and an exact match beats a fuzzy one', () => {
  const r = extractTags('21-XX-1001 21-XX-1001 21_XX_1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 1);
  assert.equal(r.review.length, 0);
});

test('extractTags reports likelyScanPDF only when nothing at all was found', () => {
  assert.equal(extractTags('NO TAGS HERE', { lookups: L }).likelyScanPDF, true);
  assert.equal(extractTags('', { lookups: L }).likelyScanPDF, true);
  assert.equal(extractTags('21-XX-1001', { lookups: L }).likelyScanPDF, false);
});

// This is the regex-state hazard called out in the spec. TAG_EXACT and
// TAG_FUZZY are global regexes; if the module lets lastIndex persist between
// calls, the SECOND drawing someone imports silently loses tags.
test('extractTags gives identical results when called repeatedly', () => {
  const opts = { drawingName: 'SP51', revision: 'C', lookups: L };
  const first = extractTags('21-XX-1001 21-YY-1002', opts);
  const second = extractTags('21-XX-1001 21-YY-1002', opts);
  const third = extractTags('21-XX-1001 21-YY-1002', opts);
  assert.deepEqual(second, first, 'regex lastIndex leaked between calls');
  assert.deepEqual(third, first);
});

test('extractTags never throws on hostile or malformed input', () => {
  const cases = [undefined, null, 0, '', [], {}, NaN, 12345, { text: 'nope' }];
  for (const bad of cases) {
    assert.doesNotThrow(() => extractTags(bad, { lookups: L }), `threw on ${JSON.stringify(bad)}`);
  }
  assert.doesNotThrow(() => extractTags('21-XX-1001', undefined));
  assert.doesNotThrow(() => extractTags('21-XX-1001', { lookups: null }));
  // A very long string must complete rather than hang.
  const huge = ('21-XX-1001 '.repeat(5000));
  assert.doesNotThrow(() => extractTags(huge, { lookups: L }));
});

test('extractTags carries drawing and revision through unchanged, including when absent', () => {
  const r = extractTags('21-XX-1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed[0].drawing, 'SP51');
  assert.equal(r.confirmed[0].revision, 'C');
  const bare = extractTags('21-XX-1001', { lookups: L });
  assert.equal(bare.confirmed[0].drawing, undefined);
  assert.equal(bare.confirmed[0].revision, undefined);
});

test('PIPE_MATERIAL_CODES is exported and contains the codes the review rule depends on', () => {
  for (const code of ['FW', 'SW', 'SS', 'ST', 'CS', 'GI', 'PE', 'CU', 'PP', 'HDPE', 'MDPE', 'PVC', 'ABS', 'CPVC', 'UPVC']) {
    assert.ok(PIPE_MATERIAL_CODES.includes(code), `missing ${code}`);
  }
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `cd "C:/Users/deaso/OneDrive/Documents/ClaudeCode/harveydeason-site" && node --test tests/pid-core.test.js`
Expected: FAIL — `Cannot find module '../assets/js/pid-core.js'`.

- [ ] **Step 3: Write the module.** Create `assets/js/pid-core.js`:

```js
// assets/js/pid-core.js
// Pure tag-extraction logic for the P&ID Tag Register: turning the text
// scraped out of a P&ID PDF into DS310 function tags. No DOM, no File System
// Access — everything here is node-testable.
//
// THE LOOKUP TABLES ARE NOT HERE, AND MUST NOT BE. assets/js/ is served
// publicly (that is why the tools themselves are encrypted), and the PAC/FC
// tables are Wessex Water DS310 reference data. They stay inside the tool and
// arrive as the `lookups` argument. Keep it that way.

function asObj(x) { return x && typeof x === 'object' ? x : {}; }
function asStr(x) { return typeof x === 'string' ? x : (x == null ? '' : String(x)); }

// A single-digit process area code paired with one of these reads as a pipe
// LINE number rather than an asset tag, so it goes to review for a human to
// confirm. These are generic material abbreviations, not DS310 data.
export const PIPE_MATERIAL_CODES = [
  'FW', 'SW', 'SS', 'ST', 'CS', 'GI', 'PE', 'CU', 'PP',
  'HDPE', 'MDPE', 'PVC', 'ABS', 'CPVC', 'UPVC',
];

// DS310 function tag: process area code - function code - identification
// number, with an optional parallel-plant letter and sub-asset code.
const TAG_EXACT = /\b(\d{1,2})-([A-Z]{1,6})-(\d{3,5}[A-Z]{0,2})\b/g;
// Looser: accepts the separators PDF text extraction tends to mangle.
const TAG_FUZZY = /\b(\d{1,2})[_.\-]([A-Z]{1,8})[_.\-](\d{2,6}[A-Z]{0,3})\b/g;

export function resolveFC(fc, lookups) {
  const l = asObj(lookups);
  return {
    cat: asObj(l.fc)[fc] || 'other',
    desc: asObj(l.fcDescriptions)[fc] || fc,
  };
}

// PDF text extraction breaks tags apart in predictable ways: en/em dashes for
// hyphens, and whitespace wherever the original had none. Repair those first,
// or the patterns below match nothing on a perfectly ordinary drawing.
export function normaliseTagText(text) {
  const clean = asStr(text)
    .replace(/[–—‒―]/g, '-')
    .replace(/--+/g, '-')
    .toUpperCase();
  return clean
    // function code and id separated by a space
    .replace(/(\d{1,2}-[A-Z]{1,6})\s+(\d{3,5}[A-Z]{0,2})(?=\s|$)/g, (_, fc, id) => `${fc}-${id}`)
    // a trailing parallel-plant letter split off from the tag
    .replace(/(\d{1,2}-[A-Z]{1,6}-\d{3,5})\s+([A-E])(?=\s|$)/g, (_, tag, suffix) => `${tag}${suffix}`)
    // spaces around either hyphen
    .replace(/(\d{1,2})\s*-\s*([A-Z]{1,6})\s*-\s*(\d{3,5}[A-Z]{0,2})/g, (_, a, b, c) => `${a}-${b}-${c}`);
}

// matchAll rather than a .exec loop over a shared global regex: matchAll works
// on an internal clone, so lastIndex never persists between calls. The old
// code reset lastIndex by hand before each loop, which worked but left the
// hazard one forgotten line away — and the symptom would have been the SECOND
// drawing of a session quietly losing tags.
export function extractTags(text, options) {
  const opts = asObj(options);
  const drawingName = opts.drawingName;
  const revision = opts.revision;
  const lookups = asObj(opts.lookups);

  const confirmed = [];
  const review = [];
  const seen = new Set();
  const clean = normaliseTagText(text);

  for (const m of clean.matchAll(TAG_EXACT)) {
    const tag = m[0];
    if (seen.has(tag)) continue;
    seen.add(tag);
    const pac = m[1], fc = m[2], id = m[3];
    const { cat, desc } = resolveFC(fc, lookups);
    const likelyLineNum = /^[1-9]$/.test(pac) && PIPE_MATERIAL_CODES.includes(fc);
    const row = { tag, pac, fc, id, desc, drawing: drawingName, revision,
      type: cat, isClash: false, isReview: likelyLineNum };
    (likelyLineNum ? review : confirmed).push(row);
  }

  for (const m of clean.matchAll(TAG_FUZZY)) {
    const norm = `${m[1]}-${m[2]}-${m[3]}`;
    if (seen.has(norm)) continue;
    // An all-digit middle group is a number range, not a function code.
    if (/^\d+$/.test(m[2])) continue;
    seen.add(norm);
    const { cat, desc } = resolveFC(m[2], lookups);
    review.push({ tag: norm, pac: m[1], fc: m[2], id: m[3], desc,
      drawing: drawingName, revision, type: cat, isClash: false, isReview: true });
  }

  return { confirmed, review, likelyScanPDF: confirmed.length + review.length === 0 };
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `node --test tests/pid-core.test.js`
Expected: PASS, all tests, including `golden: every corpus case reproduces the captured output exactly`.

**If the golden test fails, do not adjust the fixture.** The fixture is the record of what the tool does today. A mismatch means the module differs from the original — find and fix the difference in the module.

- [ ] **Step 5: Run the whole suite** to confirm nothing else moved.

Run: `npm test`
Expected: 0 failing, 2 skipped, total up by the new tests.

- [ ] **Step 6: Commit.**

```bash
git add assets/js/pid-core.js tests/pid-core.test.js
git commit -m "feat(pid-core): extract tag extraction into a tested module

The register's tag extraction decides what every downstream tag, category
and clash IS, and it lived in a 3,656-line gitignored file with no tests.

The Wessex Water lookup tables deliberately do NOT move: assets/js/ is
served publicly, so extractTags takes them as an argument and the tables
stay inside the encrypted tool.

Uses matchAll rather than exec loops over shared global regexes, so
lastIndex cannot persist between calls — the old code reset it by hand,
which worked but left the hazard one forgotten line away.

Golden fixtures captured from the live tool before the move prove output is
unchanged."
```

---

### Task 3: Point the tool at the module

**Files:**
- Modify: `tools-src/pid-tag-register.html` (gitignored — commit with `--allow-empty`)

**Interfaces:**
- Consumes: `extractTags` from Task 2.

- [ ] **Step 1: Import the module.** The tool already has a module block near the end that assigns `window.PidComments`. Add `pid-core` alongside it, so the classic script can reach it:

```js
  import * as PidCore from '/assets/js/pid-core.js';
  window.PidCore = PidCore;
```

- [ ] **Step 2: Replace the call site.** In `handlePIDFiles`, replace:

```js
      const result = extractTagsFromText(text, drawingName, revision);
```

with:

```js
      // Tag extraction lives in assets/js/pid-core.js, where it is tested.
      // The DS310 lookup tables stay here, in the encrypted tool, and are
      // passed in — they must not move to the public assets/js/.
      const result = PidCore.extractTags(text, {
        drawingName, revision,
        lookups: { fc: FC_LOOKUP, fcDescriptions: FC_DESCRIPTIONS, pac: PAC_LOOKUP },
      });
```

- [ ] **Step 3: Delete the moved functions** from the tool: `extractTagsFromText` (its whole body) and `resolveFC`. Leave `FC_LOOKUP`, `FC_DESCRIPTIONS`, `PAC_LOOKUP`, `TAG_EXACT` and `TAG_FUZZY` in place for now — Step 4 confirms whether the regexes are still referenced.

- [ ] **Step 4: Remove the now-unused regexes if nothing else uses them.**

Run: `grep -n "TAG_EXACT\|TAG_FUZZY" tools-src/pid-tag-register.html`
If the only hits are the two `const` declarations, delete them. If anything else references them, leave them and note it in the commit message.

- [ ] **Step 5: Verify the tool still parses.**

```bash
node -e "
const fs=require('fs');
const s=fs.readFileSync('tools-src/pid-tag-register.html','utf8');
const m=[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).sort((a,b)=>b.length-a.length)[0];
fs.writeFileSync(process.env.TEMP+'/pid-check.js', m);
" && node --check "$TEMP/pid-check.js" && echo "SYNTAX OK"
```

- [ ] **Step 6: Verify in a browser against the same corpus.** Start the preview server, open `http://localhost:5050/tools-src/pid-tag-register.html`, and confirm the tool now produces the golden output through the module:

```js
(async () => {
  const { FIXTURE_LOOKUPS, CORPUS } = await import('/tests/fixtures/pid-tag-corpus.js');
  const golden = await (await fetch('/tests/fixtures/pid-tag-golden.json')).json();
  const bad = [];
  for (const c of CORPUS) {
    const got = PidCore.extractTags(c.text, { drawingName: 'SP51', revision: 'C', lookups: FIXTURE_LOOKUPS });
    if (JSON.stringify(got) !== JSON.stringify(golden[c.name])) bad.push(c.name);
  }
  return JSON.stringify({
    moduleLoaded: typeof PidCore.extractTags,
    extractTagsFromTextGone: typeof window.extractTagsFromText,
    mismatches: bad,
  });
})()
```

Expected: `moduleLoaded: "function"`, `extractTagsFromTextGone: "undefined"`, `mismatches: []`.

- [ ] **Step 7: Commit.**

```bash
git commit --allow-empty -m "refactor(pid): tool delegates tag extraction to pid-core

One call site, replaced with a delegating call that passes the DS310 lookup
tables in. The tables stay in the encrypted tool; only the algorithm moved.

Source lives in gitignored tools-src/ — empty commit records the change."
```

---

### Task 4: DS310 conformance script

A local-only check, deliberately outside `npm test`: it needs a gitignored file and a standard that must not be committed.

**Files:**
- Create: `scripts/check-ds310.mjs`
- Test: `tests/check-ds310.test.js`

**Interfaces:**
- Produces: `compareCodes({ toolFc, toolDescriptions, standardCodes }) -> { missing, extra, undescribed }` — pure, testable, no file access.

- [ ] **Step 1: Write the failing test.** Create `tests/check-ds310.test.js`:

```js
// tests/check-ds310.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareCodes, parseAppendixC, parseToolTable } from '../scripts/check-ds310.mjs';

// parseToolTable earns its own tests the hard way: while scoping this work, an
// ad-hoc version of it silently matched nothing and returned {}, which turned
// the whole comparison into "the tool is missing all 252 codes". A parser that
// fails by returning empty is worse than one that throws, because the result
// still looks like an answer.
test('parseToolTable reads the keys out of a const object block', () => {
  const src = [
    'const FC_LOOKUP = {',
    "  'AA':'widget','BB':'gadget',",
    "  'CC':'widget',",
    '};',
  ].join('\n');
  assert.deepEqual(parseToolTable(src, 'FC_LOOKUP'), { AA: 'widget', BB: 'gadget', CC: 'widget' });
});

test('parseToolTable reads only the named table, not a neighbouring one', () => {
  const src = [
    'const FC_LOOKUP = {',
    "  'AA':'widget',",
    '};',
    'const PAC_LOOKUP = {',
    "  '21':'Example Area',",
    '};',
  ].join('\n');
  assert.deepEqual(parseToolTable(src, 'PAC_LOOKUP'), { 21: 'Example Area' });
});

test('parseToolTable tolerates comment lines inside the block', () => {
  const src = [
    'const FC_LOOKUP = {',
    '  // INSTRUMENTS',
    "  'AA':'instrument',",
    '};',
  ].join('\n');
  assert.deepEqual(parseToolTable(src, 'FC_LOOKUP'), { AA: 'instrument' });
});

test('parseToolTable returns {} for a table that is not there — the caller must check', () => {
  assert.deepEqual(parseToolTable('const OTHER = {};', 'FC_LOOKUP'), {});
  assert.deepEqual(parseToolTable('', 'FC_LOOKUP'), {});
  assert.deepEqual(parseToolTable(null, 'FC_LOOKUP'), {});
});

// Fictional codes: the real DS310 lists must not be committed.
test('compareCodes reports codes the standard has and the tool does not', () => {
  const r = compareCodes({
    toolFc: { AA: 'widget' },
    toolDescriptions: { AA: 'A Widget' },
    standardCodes: ['AA', 'BB', 'CC'],
  });
  assert.deepEqual(r.missing, ['BB', 'CC']);
});

test('compareCodes reports tool codes absent from the standard', () => {
  const r = compareCodes({
    toolFc: { AA: 'widget', ZZ: 'legacy' },
    toolDescriptions: {},
    standardCodes: ['AA'],
  });
  assert.deepEqual(r.extra, ['ZZ']);
});

test('compareCodes reports classified codes carrying no description', () => {
  const r = compareCodes({
    toolFc: { AA: 'widget', BB: 'gadget' },
    toolDescriptions: { AA: 'A Widget' },
    standardCodes: ['AA', 'BB'],
  });
  assert.deepEqual(r.undescribed, ['BB']);
});

test('compareCodes sorts every list, so runs are comparable', () => {
  const r = compareCodes({
    toolFc: {},
    toolDescriptions: {},
    standardCodes: ['CC', 'AA', 'BB'],
  });
  assert.deepEqual(r.missing, ['AA', 'BB', 'CC']);
});

test('compareCodes degrades rather than throwing on missing inputs', () => {
  assert.doesNotThrow(() => compareCodes({}));
  const r = compareCodes({});
  assert.deepEqual(r, { missing: [], extra: [], undescribed: [] });
});

test('parseAppendixC reads primary function codes from column 5, skipping headers', () => {
  const csv = [
    ',,,,"Issue 2",,,,',
    ',,,,1,2,3,4',
    'Code,Primary Function Type,Primary Asset Type,Unique Primary,ASSET DESCRIPTION,Primary Function Code,Primary Asset ID Code,Secondary Asset ID Code',
    'A-AAA,A,A,A,EXAMPLE,AA,A,AAA',
    'B-BBB,B,B,FALSE,,BB,B,BBB',
    ',,,,,,,',
  ].join('\n');
  assert.deepEqual(parseAppendixC(csv), ['AA', 'BB']);
});

test('parseAppendixC ignores rows whose function code is blank or not a code', () => {
  const csv = 'h\nh\nh\nx,,,,,,,\ny,,,,,123,,\nz,,,,,CC,,';
  assert.deepEqual(parseAppendixC(csv), ['CC']);
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `node --test tests/check-ds310.test.js`
Expected: FAIL — cannot find `../scripts/check-ds310.mjs`.

- [ ] **Step 3: Write the script.** Create `scripts/check-ds310.mjs`:

```js
#!/usr/bin/env node
// Compares the P&ID register's function-code tables against DS310 Appendix C.
//
// NOT part of `npm test`, on purpose. It reads two things that cannot live in
// this repo: the gitignored tool, and a Wessex Water standard we have agreed
// not to commit. Run it by hand when Appendix C is reissued.
//
//   node scripts/check-ds310.mjs "<path to appendix C csv>"

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO_ROOT, 'tools-src', 'pid-tag-register.html');

/** Pulls the quoted keys out of a `const NAME = { ... };` block. */
export function parseToolTable(source, name) {
  const re = new RegExp(`const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\};`);
  const m = re.exec(String(source || ''));
  if (!m) return {};
  const out = {};
  for (const entry of m[1].matchAll(/'([^']+)'\s*:\s*'([^']*)'/g)) out[entry[1]] = entry[2];
  return out;
}

/** Primary Function Code is column 5; the first three rows are headers. */
export function parseAppendixC(csv) {
  const seen = new Set();
  for (const line of String(csv || '').split(/\r?\n/).slice(3)) {
    if (!line.trim()) continue;
    const code = (line.split(',')[5] || '').trim();
    if (/^[A-Z]{1,6}$/.test(code)) seen.add(code);
  }
  return [...seen].sort();
}

export function compareCodes(input) {
  const cfg = input && typeof input === 'object' ? input : {};
  const toolFc = cfg.toolFc && typeof cfg.toolFc === 'object' ? cfg.toolFc : {};
  const toolDesc = cfg.toolDescriptions && typeof cfg.toolDescriptions === 'object' ? cfg.toolDescriptions : {};
  const standard = Array.isArray(cfg.standardCodes) ? cfg.standardCodes : [];
  const toolCodes = Object.keys(toolFc);
  const standardSet = new Set(standard);
  return {
    missing: standard.filter(c => !(c in toolFc)).sort(),
    extra: toolCodes.filter(c => !standardSet.has(c)).sort(),
    undescribed: toolCodes.filter(c => !(c in toolDesc)).sort(),
  };
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node scripts/check-ds310.mjs "<path to DS310 appendix C csv>"');
    process.exitCode = 1;
    return;
  }
  let source, csv;
  try {
    source = await fs.readFile(TOOL, 'utf8');
  } catch {
    console.error(`Could not read ${TOOL}. tools-src/ is gitignored — this script only works on a machine that has it.`);
    process.exitCode = 1;
    return;
  }
  try {
    csv = await fs.readFile(csvPath, 'utf8');
  } catch {
    console.error(`Could not read the Appendix C csv at ${csvPath}.`);
    process.exitCode = 1;
    return;
  }

  const toolFc = parseToolTable(source, 'FC_LOOKUP');
  const toolDescriptions = parseToolTable(source, 'FC_DESCRIPTIONS');
  const standardCodes = parseAppendixC(csv);

  // An empty parse looks exactly like "the tool classifies nothing", which
  // would be reported as every DS310 code missing. Refuse rather than present
  // a confident wrong answer — the table format has changed if this fires.
  if (!Object.keys(toolFc).length) {
    console.error('FC_LOOKUP parsed as empty. The table format in the tool has probably changed — fix parseToolTable rather than trusting this run.');
    process.exitCode = 1;
    return;
  }
  if (!standardCodes.length) {
    console.error('No function codes found in the Appendix C csv. Check the column layout (Primary Function Code is expected in column 5).');
    process.exitCode = 1;
    return;
  }

  const r = compareCodes({ toolFc, toolDescriptions, standardCodes });
  console.log(`DS310 codes the tool does not classify (${r.missing.length}):`);
  console.log('  ' + (r.missing.join(' ') || '(none)'));
  console.log(`\nTool codes absent from DS310 (${r.extra.length}):`);
  console.log('  ' + (r.extra.join(' ') || '(none)'));
  console.log(`\nClassified codes with no description (${r.undescribed.length}):`);
  console.log('  ' + (r.undescribed.join(' ') || '(none)'));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `node --test tests/check-ds310.test.js`
Expected: PASS.

- [ ] **Step 5: Run the script for real** against the owner's local Appendix C to confirm it reports the gap recorded in the spec (52 missing, 14 extra, 114 undescribed):

```bash
node scripts/check-ds310.mjs "C:/Users/deaso/Downloads/DS310 appendix C - Asset ID and Function Codes(Complete tag list).csv"
```

If the numbers differ from the spec, say so rather than quietly accepting them — the tables or the standard have changed since scoping.

- [ ] **Step 6: Commit.**

```bash
git add scripts/check-ds310.mjs tests/check-ds310.test.js
git commit -m "chore: script to check the register's codes against DS310

Local-only by necessity: it reads the gitignored tool and a Wessex Water
standard that must not be committed, so it is deliberately outside npm test.
The comparison itself is pure and tested with fictional codes."
```

---

### Task 5: Remove the dead `getPACLabel`

**Files:**
- Modify: `tools-src/pid-tag-register.html` (gitignored — commit with `--allow-empty`)

- [ ] **Step 1: Confirm it is still dead.**

Run: `grep -n "getPACLabel" tools-src/pid-tag-register.html`
Expected: exactly one hit, the `function getPACLabel(pac) {` declaration. **If there is more than one hit, stop** — it is no longer dead and this task does not apply.

- [ ] **Step 2: Delete the function.**

- [ ] **Step 3: Verify the tool still parses** using the same syntax check as Task 3 Step 5.

- [ ] **Step 4: Load the tool in a browser** and confirm no console errors, and that `typeof window.getPACLabel === 'undefined'`.

- [ ] **Step 5: Commit.**

```bash
git commit --allow-empty -m "chore(pid): delete dead getPACLabel

Zero references anywhere in the tool — only its own declaration. Found while
scoping the tag-extraction extraction; removed on its own so the deletion is
a visible decision rather than a silent omission from a new module.

Source lives in gitignored tools-src/ — empty commit records the change."
```

---

### Task 6: Verification and handoff

- [ ] **Step 1:** `npm test` — 0 failing, 2 skipped.
- [ ] **Step 2:** Confirm no DS310 data reached the repo:

```bash
grep -rn "AIT\|Analyser Indicator\|Washwater Systems" assets/js/ tests/ scripts/ || echo "clean — no DS310 reference data committed"
```

Expected: `clean`. Any hit is a constraint violation and must be removed before publishing.

- [ ] **Step 3:** Update `docs/superpowers/HANDOFF-2026-08-04-next.md` — record that tag extraction is extracted and tested, that revision detection, merge/state and families remain in the tool, and that the 52-code DS310 gap is still open.
- [ ] **Step 4: Commit** the handoff.
- [ ] **Step 5: Publish** *(owner runs this — it prompts for the workshop code)*:

```bash
node scripts/lock-tools.mjs
git add tools/ && git commit -m "build: republish tools with extracted tag-extraction core"
git push
```

Then watch the Pages build to `built` — a wedged build reports `status: "building"` with `duration: 0` and an unchanged `updated_at`, and is retriggered with `gh api -X POST repos/HarveyDeason/HarveyDeason.github.io/pages/builds`.

## Still outstanding after this

- The 52 unclassified DS310 codes, and the 14 tool codes absent from the standard.
- Revision detection, merge/state, and families/clashes — the remaining slices of the P&ID core.
- Master Log rebuild cost in the Comments Hub (~380ms at 500 comments).
