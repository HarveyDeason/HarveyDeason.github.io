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
