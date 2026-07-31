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
