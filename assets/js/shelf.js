// The Journal bookshelf: posts rendered as books standing spine-out.
// Pure functions here are DOM-free so they run under `node --test`; colours are
// deliberately absent — this module emits cloth *names* and shelf.css maps them
// to values per light/dark mode.

const SERIES_RE = /^\s*weekly\s*waffle\b/i;
const VOLUME_RE = /#\s*(\d+)/;
const SERIES_PREFIX_RE = /^\s*weekly\s*waffle\s*#?\s*\d*\s*[—–:-]?\s*/i;
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

  let shortTitle = series ? title.replace(SERIES_PREFIX_RE, '').trim() : title.trim();
  if(!shortTitle) shortTitle = 'Weekly Waffle';

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
