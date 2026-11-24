// assets/js/pid-binder.js
// Binder PDFs: one PDF holding many P&ID sheets becomes one drawing per page.
// The binder is split into one-page PDFs at import (pdf-lib, already vendored,
// is passed in), so every reader downstream sees an ordinary one-sheet PDF.
// No DOM; node-tested in tests/pid-binder.test.js.

/** A drawing number: seven dash-separated fields, e.g. D18197-ATKI-31-PR-G-P-4021. */
export const DRAWING_NUMBER = /\b[A-Z0-9]{2,8}-[A-Z0-9]{2,6}-[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]-[A-Z0-9]-\d{3,5}\b/g;

/**
 * The page's own drawing number, read from its title block, or null.
 * items: { str, x, y, size } with x, y as fractions of the page as shown
 * (rotation applied, 0,0 top-left). Only numbers in the lower-right quarter
 * count, so cross-references elsewhere on the sheet are ignored; the one
 * nearest the bottom-right corner wins, larger text breaking a near tie.
 */
export function titleBlockNumber(items) {
  let best = null;
  for (const it of items || []) {
    if (!it || typeof it.str !== 'string' || !(it.x >= 0.5) || !(it.y >= 0.5)) continue;
    const found = it.str.toUpperCase().match(DRAWING_NUMBER);
    if (!found) continue;
    const dist = Math.hypot(1 - it.x, 1 - it.y), size = Number(it.size) || 0;
    if (!best || dist < best.dist - 0.01 || (Math.abs(dist - best.dist) <= 0.01 && size > best.size)) {
      best = { number: found[0], dist, size };
    }
  }
  return best ? best.number : null;
}

/** A pdf.js page's text as the items titleBlockNumber reads. */
export async function pageNumberItems(page) {
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return content.items.filter(i => i && i.str).map(i => {
    const t = i.transform;
    const [x, y] = vp.convertToViewportPoint(t[4], t[5]);
    return { str: i.str, x: x / vp.width, y: y / vp.height, size: Math.hypot(t[2], t[3]) };
  });
}

/** One one-page PDF (Uint8Array) per page of bytes, or null if pdf-lib cannot read it. */
export async function splitPdfPages(bytes, PDFLib) {
  try {
    const src = await PDFLib.PDFDocument.load(bytes);
    const out = [];
    for (let i = 0; i < src.getPageCount(); i++) {
      const one = await PDFLib.PDFDocument.create();
      const [page] = await one.copyPages(src, [i]);
      one.addPage(page);
      out.push(await one.save());
    }
    return out.length ? out : null;
  } catch (e) {
    return null;
  }
}

/** The row's drawing name: the number found, else "<file> p<N>". */
export function binderRowName(found, fileBase, pageNo) {
  const f = typeof found === 'string' ? found.trim() : '';
  return f || (fileBase + ' p' + pageNo);
}

// Two names are the same drawing when they give the same archive file: compared
// trimmed, upper-cased (the archive folder ignores case on Windows) and, when
// asFile is given, by the file name it makes (e.g. ':' and '-' both become '-').
function sameKey(n, asFile) {
  const t = String(n).trim();
  return (asFile ? asFile(t) : t).toUpperCase();
}

/** Names (as first written, trimmed) that occur more than once. */
export function duplicateNames(names, asFile) {
  const seen = new Map(), dup = [];
  for (const n of names || []) {
    const k = sameKey(n, asFile);
    if (!seen.has(k)) seen.set(k, { first: String(n).trim(), count: 0 });
    const e = seen.get(k);
    if (++e.count === 2) dup.push(e.first);
  }
  return dup;
}

/** Names (trimmed) that match a drawing already in the register, so importing would replace it. */
export function namesAlreadyIn(names, existing, asFile) {
  const have = new Set((existing || []).map(n => sameKey(n, asFile)));
  return (names || []).filter(n => have.has(sameKey(n, asFile))).map(n => String(n).trim());
}
