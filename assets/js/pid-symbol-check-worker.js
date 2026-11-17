// assets/js/pid-symbol-check-worker.js
// Runs the symbol check off the page's thread, so the tool stays usable.
// Receives one message with a page's operator list, text items, tags and the
// library; posts progress, then one result. It holds nothing between runs.
//
// words: 'comments' (a "Readable from comments" sheet): the words come from
// the comments, and the stroked letters inside them are left out of the ink.
// words: 'printed': the letters are shapes; spotted ones are left out and no
// words are read. Otherwise the words are the text layer, as before.
import { pagePaths } from './pid-symbols.js';
import { checkSheet } from './pid-symbol-check.js';
import { commentWords, letterBoxes, removeLetterInk, removeSpottedLetters, glyphsOf } from './pid-sheet-read.js';

self.onmessage = ev => {
  try {
    const d = ev.data || {};
    let paths = pagePaths(d.fnArray, d.argsArray, d.OPS, d.viewportTransform);
    let textItems = d.textItems;
    if (d.words === 'comments') {
      paths = removeLetterInk(paths, letterBoxes(d.comments, d.viewportTransform)).paths;
      textItems = commentWords(d.comments);
    }
    let letters = null, writing = [];
    if (d.words === 'printed') {
      // Letters drawn as shapes: take them out of the linework; none is read.
      // Every glyph-sized candidate counts as writing, spotted in a row or not.
      writing = glyphsOf(paths).map(g => g.box);
      const s = removeSpottedLetters(paths);
      paths = s.paths;
      textItems = [];
      letters = { removed: s.removed, rows: s.rows };
    }
    const result = checkSheet({ paths, textItems, viewportTransform: d.viewportTransform, tags: d.words === 'printed' ? [] : d.tags, pageSize: d.pageSize, writing,
      library: d.library, lookups: d.lookups,
      onProgress: (done, total, stage) => self.postMessage({ type: 'progress', done, total, stage }) });
    result.words = d.words === 'printed' || d.words === 'comments' ? d.words : 'text';
    if (letters) result.letters = letters;
    self.postMessage({ type: 'result', result });
  } catch (e) {
    self.postMessage({ type: 'result', result: { ok: false, why: 'failed' } });
  }
};
