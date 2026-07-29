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
