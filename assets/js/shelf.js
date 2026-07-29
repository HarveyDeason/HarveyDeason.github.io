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
      `<span class="blurb" role="note">` +
        `<span class="blurb-date">${esc(fmtDate(v.dateISO))}</span>` +
        `<span class="blurb-title">${esc(v.title)}</span>` +
        `<span class="blurb-excerpt">${esc(v.excerpt)}</span>` +
      `</span>` +
    `</a>`;
}

export function renderBookcase(rows){
  if(!rows.length) return '<p class="sub">No posts yet.</p>';
  let seen = 0;
  const shelves = rows.map(row => {
    const books = row.map(v => renderSpine(v, seen++ === 0 ? 0 : -1)).join('');
    return `<div class="shelf">${books}</div><div class="shelf-board"></div>`;
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
