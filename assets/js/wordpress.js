const SITE = 'harveydeason.wordpress.com';
const BASE = `https://public-api.wordpress.com/wp/v2/sites/${SITE}/posts`;

// Named entities only — numeric forms are handled generically by decode().
const ENTITIES = {
  '&amp;':'&',
  '&lt;':'<',
  '&gt;':'>',
  '&quot;':'"',
  '&apos;':"'",
  '&ndash;':'–',
  '&mdash;':'—',
  '&lsquo;':'‘',
  '&rsquo;':'’',
  '&ldquo;':'“',
  '&rdquo;':'”',
  '&hellip;':'…',
  '&nbsp;':' '
};

// Decodes named entities via the table above and any numeric entity (decimal
// or hex) generically, so characters outside the table — emoji especially —
// survive instead of arriving as literal junk. No DOM, so this runs in node.
function decode(s){
  return String(s||'').replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if(body[0] === '#'){
      const cp = (body[1] === 'x' || body[1] === 'X')
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if(!Number.isFinite(cp) || cp < 1 || cp > 0x10FFFF) return m;
      return String.fromCodePoint(cp);
    }
    return ENTITIES[m] ?? m;
  });
}
function stripTags(s){ return decode(String(s||'')).replace(/<[^>]*>/g,'').trim(); }

// Escapes plain-text values for safe interpolation into an HTML string.
// Escape & first so entities introduced by the later replacements aren't
// double-escaped. Mirrors the `esc` helper in assets/js/shelf.js.
export function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

export function normalizePost(o){
  const media = o._embedded && o._embedded['wp:featuredmedia'];
  return {
    id: o.id,
    slug: o.slug,
    dateISO: o.date,
    title: stripTags(o.title?.rendered ?? ''),
    excerpt: stripTags(o.excerpt?.rendered ?? ''),
    cover: (media && media[0] && media[0].source_url) || null,
    html: o.content?.rendered ?? '',
  };
}

function fmtDate(iso){ try { return new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'}); } catch { return ''; } }

export function renderPostCard(p){
  return `<a class="post" href="/writing/post.html?slug=${encodeURIComponent(p.slug)}">
    <span class="date mono">${fmtDate(p.dateISO)}</span>
    <span class="t"><h3>${esc(p.title)}</h3><p>${esc(p.excerpt)}</p></span>
    <span class="a">→</span>
  </a>`;
}

// skeleton placeholders shown while the journal feed loads
export function renderSkeletonRows(n = 3){
  let out = '';
  for(let i = 0; i < n; i++){
    out += `<div class="post" aria-hidden="true">
      <span class="date skeleton" style="height:12px"></span>
      <span class="t">
        <span class="skeleton" style="display:block;height:16px;width:44%"></span>
        <span class="skeleton" style="display:block;height:13px;width:72%;margin-top:7px"></span>
      </span>
    </div>`;
  }
  return out;
}

const CACHE_TTL = 10 * 60 * 1000;
function cacheGet(k){ try{const r=JSON.parse(localStorage.getItem(k)); if(r&&Date.now()-r.t<CACHE_TTL) return r.v;}catch{} return null; }
function cacheSet(k,v){ try{localStorage.setItem(k,JSON.stringify({t:Date.now(),v}));}catch{} }

export async function fetchPosts({ perPage = 10, fetchFn = fetch } = {}){
  const key = `wp:list:${perPage}`; const hit = cacheGet(key); if(hit) return hit;
  const res = await fetchFn(`${BASE}?_embed&per_page=${perPage}`);
  if(!res.ok) throw new Error('WordPress API error '+res.status);
  const posts = (await res.json()).map(normalizePost);
  cacheSet(key, posts); return posts;
}

export async function fetchPostBySlug(slug, fetchFn = fetch){
  const res = await fetchFn(`${BASE}?_embed&slug=${encodeURIComponent(slug)}`);
  if(!res.ok) throw new Error('WordPress API error '+res.status);
  const arr = await res.json();
  return arr.length ? normalizePost(arr[0]) : null;
}

// allowlist DOM sanitiser (browser)
const ALLOWED = new Set(['P','BR','STRONG','EM','B','I','U','A','H2','H3','H4','BLOCKQUOTE','UL','OL','LI','IMG','FIGURE','FIGCAPTION','PRE','CODE','HR']);
const ATTRS = { A:['href','title'], IMG:['src','alt'] };
function safeUrl(v, kind){
  v = (v||'').trim();
  if(kind==='href') return /^(https?:|mailto:|#)/i.test(v) || (v.startsWith('/') && !v.startsWith('//'));
  return /^https?:/i.test(v) || (v.startsWith('/') && !v.startsWith('//'));
}
// validate a featured-image URL and escape it for safe attribute interpolation; null if unsafe
function safeCover(u){
  return (u && safeUrl(u,'src'))
    ? String(u).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;')
    : null;
}
export function sanitizeHtml(html){
  const tpl = document.createElement('template'); tpl.innerHTML = html;
  (function clean(node){
    [...node.childNodes].forEach(n=>{
      if(n.nodeType===1){
        const tag=n.tagName;
        clean(n);                                 // clean descendants first
        if(!ALLOWED.has(tag)){ n.replaceWith(...n.childNodes); return; }
        [...n.attributes].forEach(a=>{ if(!(ATTRS[tag]||[]).includes(a.name)) n.removeAttribute(a.name); });
        if(tag==='A'){ if(!safeUrl(n.getAttribute('href'),'href')) n.removeAttribute('href'); n.setAttribute('rel','noopener'); }
        if(tag==='IMG'){ if(!safeUrl(n.getAttribute('src'),'src')) n.removeAttribute('src'); }
      } else if(n.nodeType!==3){ n.remove(); }     // drop comments/others; keep text nodes
    });
  })(tpl.content);
  return tpl.innerHTML;
}

export function mountPosts(elId, posts){
  const el=document.getElementById(elId); if(!el) return;
  el.innerHTML = posts.length ? posts.map(renderPostCard).join('') : '<p class="sub">No posts yet.</p>';
}

export function mountSinglePost(elId, post){
  const el=document.getElementById(elId); if(!el) return;
  if(!post){ el.innerHTML='<p class="sub">Post not found. <a class="link-btn" href="/writing/">Back to the Journal →</a></p>'; return; }
  el.innerHTML = `<article class="post-article">
    <p class="post-meta mono">${new Date(post.dateISO).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</p>
    <h1 class="post-title">${esc(post.title)}</h1>
    <div class="post-body">${sanitizeHtml(post.html)}</div>
  </article>`;
}
