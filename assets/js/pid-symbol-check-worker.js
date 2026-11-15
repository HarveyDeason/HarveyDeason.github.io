// assets/js/pid-symbol-check-worker.js
// Runs the symbol check off the page's thread, so the tool stays usable.
// Receives one message with a page's operator list, text items, tags and the
// library; posts progress, then one result. It holds nothing between runs.
import { pagePaths } from './pid-symbols.js';
import { checkSheet } from './pid-symbol-check.js';

self.onmessage = ev => {
  try {
    const d = ev.data || {};
    const paths = pagePaths(d.fnArray, d.argsArray, d.OPS, d.viewportTransform);
    const result = checkSheet({ paths, textItems: d.textItems, viewportTransform: d.viewportTransform, tags: d.tags,
      library: d.library, lookups: d.lookups, onProgress: (done, total) => self.postMessage({ type: 'progress', done, total }) });
    self.postMessage({ type: 'result', result });
  } catch (e) {
    self.postMessage({ type: 'result', result: { ok: false, why: 'failed' } });
  }
};
