// tests/pid-precheck.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHX_COMMENT_AUTHOR, plainCommentText, sheetComments, countTextItems, paperSize, producedBy,
  STATUS_LABELS, sheetStatus, assessSheet, tagsToRegister, compareWithRegister, readSheetFacts,
  checkChipHtml, checkCellHtml, checkHtml, importSummary } from '../assets/js/pid-precheck.js';
import { readFileSync } from 'node:fs';
import { extractTags } from '../assets/js/pid-core.js';
import { FIXTURE_LOOKUPS, CORPUS } from './fixtures/pid-tag-corpus.js';
import { openPdf } from '../scripts/pdfjs-node.mjs';
import { sheetPdf, SHEETS } from './fixtures/sheet-pdf.js';

test('plainCommentText: strips AutoCAD formatting codes and reads a line break as a space', () => {
  assert.equal(plainCommentText('\\pxqc;{\\W0.85;M}'), 'M');
  assert.equal(plainCommentText('{\\fArial|b0|i0;21-YY-2002}'), '21-YY-2002');
  assert.equal(plainCommentText('21-XX\\P1001'), '21-XX 1001');
  assert.equal(plainCommentText('  A\\~B \n C '), 'A B C');
  for (const bad of [undefined, null, 5, {}, []]) assert.equal(plainCommentText(bad), '');
});

test('plainCommentText: strips the codes that take no semicolon, so a tag wrapped in one is still found', () => {
  assert.equal(plainCommentText('\\L21-XX-1001\\l'), '21-XX-1001');   // underline
  assert.equal(plainCommentText('\\O21-YY-1002\\o'), '21-YY-1002');   // overline
  assert.equal(plainCommentText('\\K21-XX-1003\\k'), '21-XX-1003');   // strike-through
  // An underline code followed by a semicolon later in the text must not swallow the text between.
  assert.equal(plainCommentText('\\LFEED PUMP; DUTY\\l'), 'FEED PUMP; DUTY');
  assert.deepEqual(extractTags(plainCommentText('\\L21-XX-1001\\l'), OPTS).confirmed.map(t => t.tag), ['21-XX-1001']);
});

test('sheetComments: keeps drawing-text comments, counts other mark-up, never reads it', () => {
  const anns = [
    { contentsObj: { str: '\\pxqc;{\\W0.85;M}' }, titleObj: { str: SHX_COMMENT_AUTHOR }, rect: [168, 1251, 188, 1271] },
    { contentsObj: { str: '21-XX-2001' }, titleObj: { str: 'autocad shx text' }, rect: new Float32Array([10, 20, 60, 30]) },
    { contentsObj: { str: 'change 21-XX-9999' }, titleObj: { str: 'A Reviewer' }, rect: [5, 3, 27, 25] },
    { contentsObj: { str: '   ' }, titleObj: { str: SHX_COMMENT_AUTHOR }, rect: [0, 0, 1, 1] },
    { contents: 'OLD SHAPE', title: SHX_COMMENT_AUTHOR, rect: [1, 2, 3] },
  ];
  assert.deepEqual(sheetComments(anns), { comments: [
    { text: 'M', rect: [168, 1251, 188, 1271] }, { text: '21-XX-2001', rect: [10, 20, 60, 30] }, { text: 'OLD SHAPE', rect: null }], other: 1 });
  assert.deepEqual(sheetComments(anns, { author: 'A Reviewer' }), { comments: [{ text: 'change 21-XX-9999', rect: [5, 3, 27, 25] }], other: 3 });
});

test('sheetComments and countTextItems: hostile input degrades and never throws', () => {
  for (const bad of [undefined, null, 5, 'x', {}]) assert.deepEqual(sheetComments(bad, bad), { comments: [], other: 0 });
  assert.deepEqual(sheetComments([null, 7, { contentsObj: 'x' }, { get contentsObj() { throw new Error('no'); } }]), { comments: [], other: 0 });
  assert.equal(countTextItems([{ str: 'A' }, { str: ' ' }, { str: '' }, null, { str: 5 }, { str: 'B' }]), 2);
  for (const bad of [undefined, null, 5, {}]) assert.equal(countTextItems(bad), 0);
});

test('paperSize: names the A sizes within 3 mm, either way up, and says so when it cannot', () => {
  assert.deepEqual(paperSize(2384, 1684), { name: 'A1', orientation: 'landscape', widthMm: 841, heightMm: 594, label: 'A1 landscape (841 × 594 mm)' });
  assert.equal(paperSize(2383.92, 1683.72).label, 'A1 landscape (841 × 594 mm)');
  assert.equal(paperSize(1191, 842).label, 'A3 landscape (420 × 297 mm)');
  assert.equal(paperSize(595, 842).label, 'A4 portrait (210 × 297 mm)');
  assert.deepEqual(paperSize(1000, 700), { name: '', orientation: 'landscape', widthMm: 353, heightMm: 247, label: '353 × 247 mm' });
  for (const bad of [[0, 5], ['x', 'y'], [NaN, 100], [undefined, undefined], [-5, 100]])
    assert.deepEqual(paperSize(...bad), { name: '', orientation: '', widthMm: 0, heightMm: 0, label: 'not known' });
});

test('producedBy: the program and the plotter from the PDF, empty when neither is recorded', () => {
  assert.equal(producedBy({ Creator: 'Invented CAD 1.0', Producer: 'Invented Plotter (v2)' }), 'Invented CAD 1.0 / Invented Plotter (v2)');
  assert.equal(producedBy({ Producer: 'Invented Printer' }), 'Invented Printer');
  assert.equal(producedBy({ Creator: 'Same', Producer: 'Same' }), 'Same');
  assert.equal(producedBy({ Creator: 5, Producer: '  a \n  b ' }), 'a b');
  assert.equal(producedBy({ Creator: 'x'.repeat(500) }).length, 120);
  for (const bad of [undefined, null, 5, 'x', {}, { get Creator() { throw new Error('no'); } }]) assert.equal(producedBy(bad), '');
});

// ── The status, and which tags the import registers ──
const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/pid-tag-golden.json', import.meta.url), 'utf8'));
const OPTS = { drawingName: 'SP51', revision: 'C', lookups: FIXTURE_LOOKUPS };
const tags = r => ({ confirmed: r.confirmed.map(t => t.tag), review: r.review.map(t => t.tag) });
const page = (over = {}) => ({ width: 2384, height: 1684, textItemCount: 0, comments: [], otherAnnotations: 0, ...over });
const facts = (pages, info = { Creator: 'Invented CAD 1.0', Producer: 'Invented Plotter (v2)' }) => ({ ok: true, text: '', pages, info });
const c = text => ({ text, rect: null });
// Comments and mark-up that would change the answer if they were ever allowed to.
const NOISY = facts([page({ textItemCount: 3, comments: [c('21-XX-9001'), c('21-YY-9002')], otherAnnotations: 2 })]);

test('sheetStatus: one status per sheet, from where its text can be read', () => {
  assert.equal(sheetStatus({ textItemCount: 330, textTagCount: 71, commentCount: 25 }), 'readable');
  assert.equal(sheetStatus({ textItemCount: 43, textTagCount: 0, commentCount: 47 }), 'comments');
  assert.equal(sheetStatus({ textItemCount: 0, textTagCount: 0, commentCount: 3 }), 'comments');
  assert.equal(sheetStatus({ textItemCount: 12, textTagCount: 0, commentCount: 0 }), 'readable');
  assert.equal(sheetStatus({ textItemCount: 0, textTagCount: 0, commentCount: 0 }), 'none');
  for (const bad of [undefined, null, 5, {}, { textTagCount: 'x', commentCount: NaN }]) assert.equal(sheetStatus(bad), 'none');
  assert.deepEqual(STATUS_LABELS, { readable: 'Readable', comments: 'Readable from comments', none: 'No readable text' });
});

test('golden: a drawing whose text layer gives any tag registers exactly what it does today, whatever its comments hold', () => {
  let withTags = 0;
  for (const k of CORPUS) {
    const today = GOLDEN[k.name];
    if (today.confirmed.length + today.review.length === 0) continue;
    withTags++;
    const check = assessSheet({ text: k.text, facts: NOISY, extractOptions: OPTS });
    assert.deepEqual(check.result, today, `corpus case drifted: ${k.name}`);
    assert.deepEqual([check.status, check.source], ['readable', 'text'], k.name);
    assert.equal(tagsToRegister(today, check), today, `not the same object: ${k.name}`);
  }
  assert.ok(withTags >= 19);
});

test('golden: a drawing with no tags and no comments registers exactly what it does today', () => {
  let without = 0;
  for (const k of CORPUS) {
    const today = GOLDEN[k.name];
    if (today.confirmed.length + today.review.length > 0) continue;
    without++;
    const check = assessSheet({ text: k.text, facts: facts([page({ textItemCount: 1 })]), extractOptions: OPTS });
    assert.deepEqual(check.result, today, `corpus case drifted: ${k.name}`);
    assert.equal(check.source, 'none');
    assert.equal(tagsToRegister(today, check), today);
  }
  assert.ok(without >= 3);
});

test('assessSheet: comments are read for tags only when the text layer gives none', () => {
  const f = facts([page({ width: 1191, height: 842, textItemCount: 2, comments: [
    { text: '21-XX-2001', rect: [1, 2, 3, 4] }, c('21-YY'), c('2002'), c('21_YY_2003'), c('FEED PUMP')] })]);
  const check = assessSheet({ text: 'TITLE BLOCK REV A\n', facts: f, extractOptions: OPTS });
  assert.deepEqual([check.status, check.source, check.tagCount, check.reviewCount, check.commentCount], ['comments', 'comments', 2, 1, 5]);
  assert.deepEqual(tags(check.result), { confirmed: ['21-XX-2001', '21-YY-2002'], review: ['21-YY-2003'] });
  // Rows are the same shape extractTags gives, carrying the drawing and revision asked for.
  assert.deepEqual(check.result.confirmed[0], { tag: '21-XX-2001', pac: '21', fc: 'XX', id: '2001', desc: 'Example Widget',
    drawing: 'SP51', revision: 'C', type: 'widget', isClash: false, isReview: false });
  assert.equal(check.result.likelyScanPDF, false);
  assert.deepEqual(check.findings, ['Text read from drawing comments.', '2 DS310 tags found, plus 1 for review.',
    'Made with: Invented CAD 1.0 / Invented Plotter (v2).', 'Sheet size: A3 landscape (420 × 297 mm).']);
});

test('assessSheet: labels in comments with no tags is still Readable from comments, and zero is said plainly', () => {
  const check = assessSheet({ text: 'TITLE BLOCK\n', facts: facts([page({ textItemCount: 43, comments: [c('FEED PUMP'), c('OUTLET')] })]), extractOptions: OPTS });
  assert.deepEqual([check.status, check.source, check.tagCount, check.reviewCount], ['comments', 'none', 0, 0]);
  assert.deepEqual(check.result, extractTags('TITLE BLOCK\n', OPTS));
  assert.deepEqual(check.findings.slice(0, 2), ['Text read from drawing comments.', 'No DS310 tags found.']);
});

test('assessSheet: a printed PDF has no readable text, and says what made it', () => {
  const check = assessSheet({ text: '\n', facts: facts([page()], { Creator: '', Producer: 'Invented Printer' }), extractOptions: OPTS });
  assert.deepEqual([check.status, check.source, check.textItemCount, check.commentCount], ['none', 'none', 0, 0]);
  assert.deepEqual(check.findings, ['No readable text: this PDF was printed, not plotted. Tags cannot be read.', 'No DS310 tags found.',
    'Made with: Invented Printer.', 'Sheet size: A1 landscape (841 × 594 mm).']);
  const bare = assessSheet({ text: '\n', facts: facts([page({ width: 0 })], {}), extractOptions: OPTS });
  assert.deepEqual(bare.findings.slice(2), ['Made with: not recorded in the PDF.', 'Sheet size: not known.']);
});

test('assessSheet: a reviewer\'s mark-up is counted and never read for tags', () => {
  const check = assessSheet({ text: '\n', facts: facts([page({ otherAnnotations: 2 })]), extractOptions: OPTS });
  assert.deepEqual([check.status, check.tagCount, check.otherAnnotationCount], ['none', 0, 2]);
  assert.ok(check.findings.includes('2 mark-up comments ignored.'));
  assert.ok(assessSheet({ text: '\n', facts: facts([page({ otherAnnotations: 1 })]), extractOptions: OPTS }).findings.includes('1 mark-up comment ignored.'));
});

test('assessSheet: tags that are only in comments on a readable drawing are counted, not registered', () => {
  const check = assessSheet({ text: '21-XX-1001 TITLE 21-YY 1002', facts: facts([page({ textItemCount: 3,
    comments: [c('21-XX-1001'), c('21-XX-2001'), c('21_YY_2003')] })]), extractOptions: OPTS });
  assert.deepEqual(tags(check.result), { confirmed: ['21-XX-1001', '21-YY-1002'], review: [] });
  assert.deepEqual([check.status, check.source, check.commentOnlyTagCount], ['readable', 'text', 2]);
  assert.ok(check.findings.includes('2 more tags appear only in drawing comments and were not registered.'));
  const one = assessSheet({ text: '21-XX-1001', facts: facts([page({ textItemCount: 1, comments: [c('21-XX-2001')] })]), extractOptions: OPTS });
  assert.ok(one.findings.includes('1 more tag appears only in drawing comments and was not registered.'));
  assert.equal(one.findings[0], '1 DS310 tag found.');
});

test('assessSheet: one status for the whole PDF; the first page gives the size', () => {
  const check = assessSheet({ text: '\n\n', facts: facts([page(), page({ width: 1191, height: 842, comments: [c('21-XX-3001')] })]), extractOptions: OPTS });
  assert.deepEqual([check.status, check.source, check.tagCount, check.pageCount], ['comments', 'comments', 1, 2]);
  assert.equal(check.findings.at(-1), 'Sheet size: A1 landscape (841 × 594 mm), 2 pages.');
  const text = assessSheet({ text: 'GENERAL NOTES', facts: facts([page(), page({ textItemCount: 2 })]), extractOptions: OPTS });
  assert.deepEqual([text.status, text.source, text.findings[0]], ['readable', 'none', 'No DS310 tags found.']);
});

test('assessSheet: no usable facts means no check, and hostile input never throws', () => {
  for (const bad of [undefined, null, 5, 'x', {}, { facts: 5 }, { text: '21-XX-1001', facts: { ok: false, pages: [] } }, { text: '21-XX-1001' }])
    assert.equal(assessSheet(bad), null);
  const odd = assessSheet({ text: {}, facts: { ok: true, pages: [null, 5, { comments: 'x', textItemCount: 'y' }, { comments: [null, { text: 7 }] }], info: 9 }, extractOptions: 3 });
  assert.deepEqual([odd.status, odd.source, odd.pageCount, odd.commentCount], ['none', 'none', 4, 0]);
});

test('tagsToRegister: the text result itself unless it is empty and the comments gave tags', () => {
  const some = extractTags('21-XX-1001', OPTS), none = extractTags('NOTHING', OPTS);
  const fromComments = assessSheet({ text: 'NOTHING', facts: facts([page({ comments: [c('21-XX-2001')] })]), extractOptions: OPTS });
  assert.equal(tagsToRegister(some, fromComments), some);
  assert.equal(tagsToRegister(none, fromComments), fromComments.result);
  for (const noCheck of [null, undefined, 5, {}, { source: 'comments' }, { source: 'comments', result: { confirmed: [], review: [] } },
    { source: 'text', result: fromComments.result }]) assert.equal(tagsToRegister(none, noCheck), none);
  // A review-only text result still counts as tags found: comments are not consulted.
  const reviewOnly = extractTags('21_YY_1014', OPTS);
  assert.equal(tagsToRegister(reviewOnly, fromComments), reviewOnly);
});

test('compareWithRegister: what an import would read now against what the register holds', () => {
  const now = extractTags('21-XX-1001 21-YY-1002 1-PP-1011 21_YY_1014', OPTS);
  const snapshot = [...now.confirmed, ...now.review].map(t => ({ tag: t.tag, isReview: !!t.isReview }));
  assert.deepEqual(compareWithRegister(now, snapshot), { same: true, nowCount: 4, registerCount: 4, added: [], missing: [], changed: [] });
  assert.deepEqual(compareWithRegister(now, [{ tag: '21-XX-1001', isReview: true }, { tag: '21-ZZ-7000', isReview: false }, { tag: '1-PP-1011', isReview: true }]),
    { same: false, nowCount: 4, registerCount: 3, added: ['21-YY-1002', '21-YY-1014'], missing: ['21-ZZ-7000'], changed: ['21-XX-1001'] });
  for (const bad of [undefined, null, 5, {}]) assert.deepEqual(compareWithRegister(bad, bad), { same: true, nowCount: 0, registerCount: 0, added: [], missing: [], changed: [] });
  assert.equal(compareWithRegister(null, [{ tag: '21-XX-1001' }]).same, false);
});

// ── Fetching the facts from pdf.js ──
const TODAY = JSON.parse(readFileSync(new URL('./fixtures/sheet-import-golden.json', import.meta.url), 'utf8'));
const read = async spec => readSheetFacts(await openPdf(sheetPdf(spec)));

test('readSheetFacts: text, comments, mark-up, sizes and programs from a real pdf.js document', async () => {
  assert.deepEqual(await read(SHEETS.plotted), { ok: true, text: '21-XX-1001 TITLE BLOCK 21-YY 1002\n\n',
    pages: [
      { width: 2384, height: 1684, textItemCount: 3, otherAnnotations: 1,
        comments: [{ text: 'M', rect: [168, 1251, 188, 1271] }, { text: '21-XX-2001', rect: [10, 20, 60, 30] }] },
      { width: 1191, height: 842, textItemCount: 0, comments: [], otherAnnotations: 0 }],
    info: { Creator: 'Invented CAD 1.0', Producer: 'Invented Plotter (v2)' } });
  const printed = await read(SHEETS.printed);
  assert.deepEqual([printed.text, printed.pages[0].textItemCount, printed.pages[0].comments, printed.info], ['\n', 0, [], { Creator: '', Producer: 'Invented Printer' }]);
  assert.deepEqual((await read({ pages: [{ text: ['X'] }] })).info, { Creator: '', Producer: '' });
});

test('golden: the text read here is the text the tool reads today, and the same tags are registered', async () => {
  for (const [name, spec] of Object.entries(SHEETS)) {
    const f = await read(spec), today = TODAY[name];
    assert.equal(f.text, today.text, `text drifted: ${name}`);
    const textResult = extractTags(f.text, { drawingName: 'INVENTED-001', revision: 'C01', lookups: {} });
    assert.deepEqual({ ...tags(textResult), likelyScanPDF: textResult.likelyScanPDF }, { confirmed: today.confirmed, review: today.review, likelyScanPDF: today.likelyScanPDF }, name);
    const check = assessSheet({ text: f.text, facts: f, extractOptions: { drawingName: 'INVENTED-001', revision: 'C01', lookups: {} } });
    const registered = tagsToRegister(textResult, check);
    assert.deepEqual(registered, check.result, name);
    // The whole change this work makes to the register, in one place:
    if (name === 'commentsWithTags') assert.deepEqual(tags(registered), { confirmed: ['21-XX-3001', '21-YY-3002', '21-XX-3003'], review: ['21-YY-3004'] });
    else if (name === 'hostile') assert.deepEqual(tags(registered), { confirmed: ['21-XX-4001'], review: [] });
    else assert.equal(registered, textResult, `${name} must register what it does today`);
  }
});

test('each invented sheet gets the status it should', async () => {
  const got = {};
  for (const [name, spec] of Object.entries(SHEETS)) {
    const f = await read(spec);
    const check = assessSheet({ text: f.text, facts: f, extractOptions: OPTS });
    got[name] = [check.status, check.source, check.tagCount, check.reviewCount, check.commentOnlyTagCount, check.otherAnnotationCount];
  }
  assert.deepEqual(got, {
    plotted: ['readable', 'text', 2, 0, 1, 1],
    printed: ['none', 'none', 0, 0, 0, 0],
    commentsWithTags: ['comments', 'comments', 3, 1, 0, 0],
    commentsNoTags: ['comments', 'none', 0, 0, 0, 0],
    printedWithMarkup: ['none', 'none', 0, 0, 0, 2],
    hostile: ['comments', 'comments', 1, 0, 0, 0],
  });
});

test('readSheetFacts: a failed read is reported, a failed part is left out, and nothing throws', async () => {
  const empty = { ok: false, text: '', pages: [], info: { Creator: '', Producer: '' } };
  for (const bad of [undefined, null, 5, {}, { numPages: 1 }, { numPages: 1, getPage: async () => { throw new Error('no'); } }])
    assert.deepEqual(await readSheetFacts(bad), empty);
  const partial = { numPages: 1,
    getPage: async () => ({ getViewport: () => ({ width: 200, height: 100 }), getTextContent: async () => ({ items: [{ str: 'A' }] }),
      getAnnotations: async () => { throw new Error('no'); } }),
    getMetadata: async () => { throw new Error('no'); } };
  assert.deepEqual(await readSheetFacts(partial), { ok: true, text: 'A\n',
    pages: [{ width: 200, height: 100, textItemCount: 1, comments: [], otherAnnotations: 0 }], info: { Creator: '', Producer: '' } });
});

// ── What the user sees ──

const check = async name => { const f = await read(SHEETS[name]); return assessSheet({ text: f.text, facts: f, extractOptions: OPTS }); };

test('checkChipHtml and checkCellHtml: the status, with the findings on hover', async () => {
  const printed = await check('printed');
  assert.equal(checkChipHtml(printed), '<span class="pc-chip pc-none" title="No readable text: this PDF was printed, not plotted. Tags cannot be read. '
    + 'No DS310 tags found. Made with: Invented Printer. Sheet size: A1 landscape (841 × 594 mm).">No readable text</span>');
  assert.equal(checkCellHtml(printed), checkChipHtml(printed) + ' <span class="pc-note">No DS310 tags found.</span>');
  const plotted = await check('plotted');
  assert.ok(checkChipHtml(plotted).startsWith('<span class="pc-chip pc-readable" title="2 DS310 tags found. '));
  assert.ok(checkCellHtml(plotted).endsWith('>Readable</span> <span class="pc-note">2 DS310 tags found.</span>'));
  assert.ok(checkCellHtml(await check('commentsWithTags')).endsWith('>Readable from comments</span> <span class="pc-note">3 DS310 tags found, plus 1 for review.</span>'));
});

test('a sheet that could not be checked says so, in every view', () => {
  const chip = '<span class="pc-chip pc-unknown" title="This sheet could not be checked.">Not checked</span>';
  for (const bad of [null, undefined, 5, 'x', {}, { status: 'made-up' }, { status: 'constructor' }]) {
    assert.equal(checkChipHtml(bad), chip);
    assert.equal(checkCellHtml(bad), chip);
    assert.equal(checkHtml(bad, { same: true, nowCount: 3 }), '<div class="pc-line">' + chip + ' <span class="pc-finding">This sheet could not be checked.</span></div>');
  }
});

test('checkHtml: every finding, then how the tags read now compare with the register', async () => {
  const plotted = await check('plotted');
  assert.equal(checkHtml(plotted), '<div class="pc-line">' + checkChipHtml(plotted)
    + ' <span class="pc-finding">2 DS310 tags found.</span>'
    + ' <span class="pc-finding">1 more tag appears only in drawing comments and was not registered.</span>'
    + ' <span class="pc-finding">1 mark-up comment ignored.</span>'
    + ' <span class="pc-finding">Made with: Invented CAD 1.0 / Invented Plotter (v2).</span>'
    + ' <span class="pc-finding">Sheet size: A1 landscape (841 × 594 mm), 2 pages.</span></div>');
  assert.ok(checkHtml(plotted, { same: true, nowCount: 2 }).endsWith(' <span class="pc-compare pc-same">Tags read now match the register (2).</span></div>'));
  const differ = { same: false, nowCount: 4, registerCount: 3, added: ['21-YY-1002', '21-YY-1014'], missing: ['21-ZZ-7000'], changed: ['21-XX-1001'] };
  assert.ok(checkHtml(plotted, differ).endsWith(' <span class="pc-compare pc-differ">Tags read now differ from the register: '
    + '2 not in the register (21-YY-1002, 21-YY-1014); 1 in the register but not read now (21-ZZ-7000); '
    + '1 changed between confirmed and review (21-XX-1001).</span></div>'));
  const many = { same: false, added: Array.from({ length: 12 }, (_, i) => '21-XX-' + (5000 + i)), missing: [], changed: [] };
  assert.ok(checkHtml(plotted, many).includes('12 not in the register (21-XX-5000, 21-XX-5001, 21-XX-5002, 21-XX-5003, 21-XX-5004, 21-XX-5005, 21-XX-5006, 21-XX-5007, 21-XX-5008, 21-XX-5009 and 2 more).'));
  for (const none of [null, undefined, 5, 'x']) assert.equal(checkHtml(plotted, none), checkHtml(plotted));
});

test('markup in the PDF metadata, a comment or a tag list is shown as text', async () => {
  const hostile = await check('hostile');
  const differ = { same: false, added: ['<img src=x onerror=alert(3)>'], missing: [], changed: [] };
  for (const html of [checkChipHtml(hostile), checkCellHtml(hostile), checkHtml(hostile, differ)]) {
    assert.ok(!/<(img|script|b)\b/i.test(html), html);
    assert.ok(!/title="[^"]*"[^>]*"/.test(html), 'an attribute was broken out of: ' + html);
  }
  assert.ok(checkHtml(hostile).includes('Made with: &lt;img src=x onerror=alert(1)&gt; / &quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;.'));
});

test('importSummary: says how many PDFs will be registered with no tags, and nothing when all read', async () => {
  const plotted = await check('plotted'), printed = await check('printed'), noTags = await check('commentsNoTags');
  assert.equal(importSummary([plotted, await check('commentsWithTags')]), '');
  assert.equal(importSummary([plotted, printed, noTags]), '1 of 3 PDFs has no readable text. 1 of 3 has readable text but no DS310 tags. Importing registers them with no tags.');
  assert.equal(importSummary([printed]), '1 of 1 PDF has no readable text. Importing registers it with no tags.');
  assert.equal(importSummary([printed, printed, null]), '2 of 3 PDFs have no readable text. 1 of 3 could not be checked. Importing registers them with no tags.');
  assert.equal(importSummary([null, undefined]), '2 of 2 could not be checked.');
  for (const bad of [undefined, null, 5, {}, []]) assert.equal(importSummary(bad), '');
});
