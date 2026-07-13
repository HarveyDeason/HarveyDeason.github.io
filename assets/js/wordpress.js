const SITE = 'harveydeason.wordpress.com';
const BASE = `https://public-api.wordpress.com/wp/v2/sites/${SITE}/posts`;

const ENTITIES = {
  '&amp;':'&',
  '&#038;':'&',
  '&#8211;':'–',
  '&#8212;':'—',
  '&#8217;':'’',
  '&#8216;':'‘',
  '&#8220;':'“',
  '&#8221;':'”',
  '&#8230;':'…',
  '&hellip;':'…',
  '&nbsp;':' '
};
function decode(s){ return String(s||'').replace(/&#?\w+;/g, m => ENTITIES[m] ?? m); }
function stripTags(s){ return decode(String(s||'').replace(/<[^>]*>/g,'')).trim(); }

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

function fmtDate(iso){ try { return new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}); } catch { return ''; } }

export function renderPostCard(p){
  const cImg = safeCover(p.cover);
  const cover = cImg ? `<div class="post-cover" style="background-image:url('${cImg}')"></div>` : '';
  return `<a class="card post-card" href="/writing/post.html?slug=${encodeURIComponent(p.slug)}" data-anim="tilt">
    ${cover}
    <span class="label">${fmtDate(p.dateISO)}</span>
    <h3>${p.title}</h3>
    <p>${p.excerpt}</p>
  </a>`;
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
  el.innerHTML = posts.length ? posts.map(renderPostCard).join('') : '<p class="label">No posts yet.</p>';
}

export function mountSinglePost(elId, post){
  const el=document.getElementById(elId); if(!el) return;
  if(!post){ el.innerHTML='<p class="label">Post not found. <a class="gilt-link" href="/writing/">Back to the Journal →</a></p>'; return; }
  const cImg = safeCover(post.cover);
  const cover = cImg ? `<img class="post-hero" src="${cImg}" alt="">` : '';
  el.innerHTML = `<article class="post">
    <div class="label">${new Date(post.dateISO).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</div>
    <h1 class="post-title">${post.title}</h1>
    ${cover}
    <div class="post-body">${sanitizeHtml(post.html)}</div>
  </article>`;
}
