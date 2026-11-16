// assets/js/pid-symbol-check-worker.js
// Runs the symbol check off the page's thread, so the tool stays usable.
// Receives one message with a page's operator list, text items, tags and the
// library; posts progress, then one result. It holds nothing between runs.
//
// words: 'comments' (a "Readable from comments" sheet): the words come from
// the comments, and the stroked letters inside them are left out of the ink.
// Otherwise the words are the text layer, as before.
import { pagePaths } from './pid-symbols.js';
import { checkSheet } from './pid-symbol-check.js';
import { commentWords, letterBoxes, removeLetterInk } from './pid-sheet-read.js';

self.onmessage = ev => {
  try {
    const d = ev.data || {};
    let paths = pagePaths(d.fnArray, d.argsArray, d.OPS, d.viewportTransform);
    let textItems = d.textItems;
    if (d.words === 'comments') {
      paths = removeLetterInk(paths, letterBoxes(d.comments, d.viewportTransform)).paths;
      textItems = commentWords(d.comments);
    }
    const result = checkSheet({ paths, textItems, viewportTransform: d.viewportTransform, tags: d.tags, pageSize: d.pageSize,
      library: d.library, lookups: d.lookups,
      onProgress: (done, total, stage) => self.postMessage({ type: 'progress', done, total, stage }) });
    self.postMessage({ type: 'result', result });
  } catch (e) {
    self.postMessage({ type: 'result', result: { ok: false, why: 'failed' } });
  }
};
