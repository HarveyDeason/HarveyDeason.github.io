// The Journal bookshelf: posts rendered as books standing spine-out.
// Pure functions here are DOM-free so they run under `node --test`; colours are
// deliberately absent — this module emits cloth *names* and shelf.css maps them
// to values per light/dark mode.

const SERIES_RE = /^\s*weekly\s*waffle\b/i;
const VOLUME_RE = /#\s*(\d+)/;
// Separator left dangling after the volume number is stripped (dash, colon,
// or just whitespace) — the dash can sit before OR after "#N" in live titles.
const TRAILING_SEPARATOR_RE = /^\s*[—–:-]?\s*/;
const WRAPPED_IN_PARENS_RE = /^\((.*)\)$/;
const SINGLE_CLOTHS = ['oxblood','navy','tan','plum'];

// FNV-style rolling hash. Stable across sessions so a book never changes
// colour or size between visits.
export function hashSlug(slug){
  let h = 0;
  const s = String(slug || '');
  for(let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function toVolume(post){
  const title  = String(post.title || '');
  const series = SERIES_RE.test(title);
  const h      = hashSlug(post.slug);

  const volMatch = series ? title.match(VOLUME_RE) : null;
  const volume   = volMatch ? volMatch[1].padStart(2, '0') : '';

  let shortTitle;
  if(series && volMatch){
    // Anchor on the volume number itself, not on the literal series name —
    // titles put the separator dash before or after "#N" inconsistently.
    const rest = title.slice(volMatch.index + volMatch[0].length);
    shortTitle = rest.replace(TRAILING_SEPARATOR_RE, '').trim();
    const wrapped = shortTitle.match(WRAPPED_IN_PARENS_RE);
    if(wrapped) shortTitle = wrapped[1].trim();
    if(!shortTitle) shortTitle = 'Weekly Waffle';
  } else {
    shortTitle = title.trim();
  }

  return {
    slug: post.slug,
    title,
    shortTitle,
    dateISO: post.dateISO,
    excerpt: post.excerpt || '',
    series,
    volume,
    cloth: series ? 'series' : SINGLE_CLOTHS[h % SINGLE_CLOTHS.length],
    width:  30 + (h % 5) * 4,
    height: 196 + (h % 7) * 13,
    depth:  46 + (h % 4) * 7
  };
}

// Greedy left-to-right packing. Deterministic: the same volumes at the same
// width always produce the same rows, so a resize back to a previous width
// restores the previous layout exactly.
export function packShelves(volumes, containerWidth, gap = 2){
  // Normalize non-finite widths to Infinity so degenerate cases fail safe:
  // NaN comparisons would leave books on one row by accident; we want it explicit.
  if(!Number.isFinite(containerWidth)) containerWidth = Infinity;

  // A width of 0 or less yields one book per row — intentional, as the first
  // book in a row is always accepted regardless of width.

  const rows = [];
  let row = [], used = 0;

  for(const v of volumes){
    const cost = row.length ? gap + v.width : v.width;
    if(row.length && used + cost > containerWidth){
      rows.push(row);
      row = [v]; used = v.width;
    } else {
      row.push(v); used += cost;
    }
  }
  if(row.length) rows.push(row);
  return rows;
}

function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtDate(iso){
  try { return new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}); }
  catch { return ''; }
}

// A single book. Hubs and rules are decorative; the panel carries the title.
// Positions are proportional to height so tall and short books stay in family.
export function renderSpine(v, tabindex = -1){
  const h = v.height;
  return `<a class="book" href="/writing/post.html?slug=${encodeURIComponent(v.slug)}"` +
    ` data-slug="${esc(v.slug)}" data-cloth="${esc(v.cloth)}" tabindex="${tabindex}"` +
    ` aria-label="${esc(v.title)}"` +
    ` data-date="${esc(fmtDate(v.dateISO))}" data-excerpt="${esc(v.excerpt)}"` +
    ` style="--w:${v.width}px;--h:${v.height}px;--d:${v.depth}px">` +
      `<span class="book-top"></span>` +
      `<span class="spine">` +
        `<span class="hub" style="top:${Math.round(h * 0.14)}px"></span>` +
        `<span class="hub" style="bottom:${Math.round(h * 0.20)}px"></span>` +
        `<span class="rule" style="top:7px"></span>` +
        `<span class="rule" style="bottom:7px"></span>` +
        `<span class="panel" style="top:${Math.round(h * 0.205)}px;bottom:${Math.round(h * 0.275)}px">` +
          `<span class="ttl">${esc(v.shortTitle)}</span>` +
        `</span>` +
        (v.volume ? `<span class="vol" style="bottom:${Math.round(h * 0.10)}px">${esc(v.volume)}</span>` : '') +
      `</span>` +
    `</a>`;
}

export function renderBookcase(rows){
  if(!rows.length) return '<p class="sub">No posts yet.</p>';
  let seen = 0;
  const shelves = rows.map(row => {
    const books = row.map(v => renderSpine(v, seen++ === 0 ? 0 : -1)).join('');
    return `<div class="shelf">${books}</div><div class="shelf-board"></div>` +
      `<div class="shelf-blurb" role="note" aria-live="polite">` +
        `<span class="blurb-date"></span><span class="blurb-title"></span><span class="blurb-excerpt"></span>` +
      `</div>`;
  }).join('');
  return `<div class="bookcase">${shelves}</div>`;
}

// Placeholder spines shown while the feed loads, so the case does not pop in.
export function renderSkeletonShelf(n = 12){
  let out = '';
  for(let i = 0; i < n; i++){
    const w = 30 + (i % 5) * 4, h = 196 + (i % 7) * 13;
    out += `<span class="book skeleton-book" aria-hidden="true" style="--w:${w}px;--h:${h}px"></span>`;
  }
  return `<div class="bookcase"><div class="shelf">${out}</div><div class="shelf-board"></div></div>`;
}

// Renders the case into `elId`. Width is injectable so callers (and resize
// handlers) control packing without this module reading layout twice.
export function mountShelf(elId, posts, width){
  const el = document.getElementById(elId);
  if(!el) return;
  const w = width || el.clientWidth || 900;
  const volumes = posts.map(toVolume);
  el.innerHTML = renderBookcase(packShelves(volumes, w));
}

// Interaction. One book is "open" (pulled out) at a time.
//
// Pointer: hover opens, leaving the case closes.
// Keyboard: roving tabindex, arrows traverse, focus opens, Enter follows the link.
// Touch: first tap opens without navigating, second tap on the same book follows.
export function initShelf(el){
  if(!el || el.dataset.shelfWired === '1') return;
  el.dataset.shelfWired = '1';

  const books = () => Array.from(el.querySelectorAll('.book:not(.skeleton-book)'));
  let openBook = null;

  // Each shelf owns one blurb panel shared by its books, so opening a book
  // repaints that panel rather than revealing a panel of its own.
  function panelFor(book){
    const shelf = book && book.closest('.shelf');
    if(!shelf) return null;
    // Walk forward to the first .shelf-blurb, rather than assuming a fixed
    // .shelf → .shelf-board → .shelf-blurb chain.
    let n = shelf.nextElementSibling;
    while(n && !n.classList.contains('shelf-blurb')){
      if(n.classList.contains('shelf')) return null;   // ran into the next row
      n = n.nextElementSibling;
    }
    return n || null;
  }

  function fill(panel, book){
    if(!panel) return;
    const set = (sel, text) => {
      const n = panel.querySelector(sel);
      if(n) n.textContent = text || '';
    };
    set('.blurb-date', book.getAttribute('data-date'));
    set('.blurb-title', book.getAttribute('aria-label'));
    set('.blurb-excerpt', book.getAttribute('data-excerpt'));
  }

  function open(book){
    if(openBook && !el.contains(openBook)) openBook = null;   // survived a re-render
    if(openBook === book) return;
    if(openBook){
      openBook.classList.remove('is-open');
      const prev = panelFor(openBook);
      // Only hide the old panel if the new book lives on a different shelf;
      // otherwise it is the same element and we are about to repaint it.
      if(prev && prev !== panelFor(book)) prev.classList.remove('is-showing');
    }
    openBook = book;
    if(book){
      book.classList.add('is-open');
      const panel = panelFor(book);
      fill(panel, book);
      if(panel) panel.classList.add('is-showing');
    }
  }

  function focusBook(book){
    if(!book) return;
    books().forEach(b => b.tabIndex = -1);
    book.tabIndex = 0;
    book.focus();
  }

  // ——— pointer ———
  el.addEventListener('pointerover', e => {
    if(e.pointerType === 'touch') return;
    const book = e.target.closest('.book');
    if(book && !book.classList.contains('skeleton-book')) open(book);
  });
  el.addEventListener('pointerleave', e => {
    if(e.pointerType === 'touch') return;
    open(null);
  });

  // ——— keyboard ———
  el.addEventListener('focusin', e => {
    const book = e.target.closest('.book');
    if(book) open(book);
  });
  el.addEventListener('keydown', e => {
    const book = e.target.closest('.book');
    if(!book) return;
    const all = books();
    const i = all.indexOf(book);

    if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
      e.preventDefault();
      focusBook(all[e.key === 'ArrowRight' ? Math.min(i + 1, all.length - 1) : Math.max(i - 1, 0)]);
      return;
    }
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      const shelves = Array.from(el.querySelectorAll('.shelf'));
      const here = book.closest('.shelf');
      const next = shelves[shelves.indexOf(here) + (e.key === 'ArrowDown' ? 1 : -1)];
      if(!next) return;
      const row = Array.from(next.querySelectorAll('.book'));
      const within = Array.from(here.querySelectorAll('.book')).indexOf(book);
      focusBook(row[Math.min(within, row.length - 1)]);
      return;
    }
    if(e.key === 'Escape'){ open(null); book.blur(); }
  });

  // ——— touch: first tap opens, second follows ———
  el.addEventListener('click', e => {
    const book = e.target.closest('.book');
    if(!book) return;
    if(matchMedia('(pointer:fine)').matches) return;   // mouse users navigate on first click
    if(openBook !== book){ e.preventDefault(); open(book); }
  });
}

// Repacks when the container width changes. Packing is deterministic, so we
// skip re-rendering unless the width actually moved — this keeps the open book
// from being torn out from under the pointer during vertical scroll on mobile,
// where toolbars change the viewport height but not the width.
export function observeShelf(elId, posts){
  const el = document.getElementById(elId);
  if(!el) return;

  let lastWidth = 0, timer = null;
  const render = () => {
    const w = el.clientWidth;
    if(w === lastWidth) return;
    lastWidth = w;
    mountShelf(elId, posts, w);
    // initShelf delegates from `el` itself, which survives the innerHTML
    // replacement above, so the listeners are still attached and still see the
    // new children. Deliberately do NOT clear `el.dataset.shelfWired` and
    // re-run it: that would stack a duplicate set of listeners on every resize.
    initShelf(el);
  };

  render();
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  }).observe(el);
}
