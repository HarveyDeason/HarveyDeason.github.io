// Command palette (Ctrl+K / ⌘K) — a small "concierge" for the whole site.
// searchIndex() is a pure function (no DOM) so it can be unit-tested in Node.
// The dialog code below only runs in the browser, on init / open.

import { loadTools } from './tools.js';
import { fetchPosts } from './wordpress.js';

const CAP = 5;
const GROUPS = ['instruments', 'journal', 'pages'];

// Static destinations, always searchable even offline.
const PAGES = [
  { group:'pages', title:'Instruments', keywords:'tools cabinet', href:'/tools/' },
  { group:'pages', title:'Journal',     keywords:'writing essays blog', href:'/writing/' },
  { group:'pages', title:'About',       keywords:'harvey deason bio', href:'/about/' },
  { group:'pages', title:'Contact',     keywords:'email get in touch', href:'/contact/' },
];

// Pure, case-insensitive substring match on title + keywords.
// Returns { instruments:[], journal:[], pages:[] }, each capped at CAP.
export function searchIndex(items, query){
  const q = String(query || '').trim().toLowerCase();
  const out = { instruments:[], journal:[], pages:[] };
  for(const it of (items || [])){
    const bucket = out[it.group];
    if(!bucket || bucket.length >= CAP) continue;
    if(q){
      const hay = (String(it.title||'') + ' ' + String(it.keywords||'')).toLowerCase();
      if(!hay.includes(q)) continue;
    }
    bucket.push(it);
  }
  return out;
}

const GROUP_LABELS = { instruments:'Instruments', journal:'Journal', pages:'Pages' };

function toolItem(t){
  return {
    group:'instruments',
    title:t.name,
    keywords:[(t.tags||[]).join(' '), t.blurb, t.slug].filter(Boolean).join(' '),
    href:`/tools/${t.slug}.html`,
  };
}
function postItem(p){
  return {
    group:'journal',
    title:p.title,
    keywords:p.excerpt || '',
    href:`/writing/post.html?slug=${encodeURIComponent(p.slug)}`,
  };
}

// initPalette({ tools, postsPromise }) — both optional.
// Pages that have already loaded tools/posts pass them in to share the fetch;
// pages that haven't (about/contact) pass nothing and palette lazy-loads on
// first open. Instruments + Pages always work; Journal fills in once posts
// resolve, and a failed posts fetch never blocks the palette.
export function initPalette(opts = {}){
  if(typeof document === 'undefined') return;      // safety: no-op outside browser

  let items = PAGES.slice();
  let dataStarted = false;
  let overlay = null, card = null, input = null, resultsEl = null;
  let rows = [], activeIndex = 0, isOpen = false, lastFocused = null;

  const reduceMotion = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ensureData(){
    if(dataStarted) return;
    dataStarted = true;
    const toolsP = opts.tools ? Promise.resolve(opts.tools) : loadTools();
    Promise.resolve(toolsP)
      .then(tools => { items = items.concat((tools || []).map(toolItem)); if(isOpen) render(); })
      .catch(() => {});
    const postsP = opts.postsPromise || fetchPosts({ perPage:20 });
    Promise.resolve(postsP)
      .then(posts => { items = items.concat((posts || []).map(postItem)); if(isOpen) render(); })
      .catch(() => {});
  }

  function build(){
    overlay = document.createElement('div');
    overlay.className = 'palette-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Site search');

    card = document.createElement('div');
    card.className = 'palette-card';

    input = document.createElement('input');
    input.type = 'text';
    input.className = 'palette-input';
    input.setAttribute('aria-label', 'Search');
    input.setAttribute('placeholder', 'Search instruments, journal, pages…');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');

    resultsEl = document.createElement('div');
    resultsEl.className = 'palette-results';

    card.appendChild(input);
    card.appendChild(resultsEl);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    overlay.addEventListener('mousedown', e => { if(e.target === overlay) close(); });
    input.addEventListener('input', render);
    overlay.addEventListener('keydown', onKeydown);
  }

  function setActive(i){
    if(!rows.length) return;
    activeIndex = (i + rows.length) % rows.length;
    syncActive();
  }
  function syncActive(){
    rows.forEach((r, i) => {
      const on = i === activeIndex;
      r.classList.toggle('palette-row-active', on);
      r.setAttribute('aria-selected', String(on));
      if(on) r.scrollIntoView({ block:'nearest' });
    });
  }

  function render(){
    const grouped = searchIndex(items, input.value);
    resultsEl.innerHTML = '';
    rows = [];
    for(const key of GROUPS){
      const list = grouped[key];
      if(!list.length) continue;
      const g = document.createElement('div');
      g.className = 'palette-group';
      g.textContent = GROUP_LABELS[key];
      resultsEl.appendChild(g);
      for(const it of list){
        const r = document.createElement('button');
        r.type = 'button';
        r.className = 'palette-row';
        r.tabIndex = -1;
        r.setAttribute('role', 'option');
        r.dataset.href = it.href;
        const t = document.createElement('span');
        t.className = 'palette-row-title';
        t.textContent = it.title;
        r.appendChild(t);
        const idx = rows.length;
        r.addEventListener('click', () => go(it.href));
        r.addEventListener('mousemove', () => setActive(idx));
        resultsEl.appendChild(r);
        rows.push(r);
      }
    }
    if(!rows.length){
      const e = document.createElement('div');
      e.className = 'palette-empty';
      e.textContent = 'No matches.';
      resultsEl.appendChild(e);
    }
    activeIndex = 0;
    syncActive();
  }

  function onKeydown(e){
    if(e.key === 'Escape'){ e.preventDefault(); close(); return; }
    if(e.key === 'ArrowDown'){ e.preventDefault(); setActive(activeIndex + 1); return; }
    if(e.key === 'ArrowUp'){ e.preventDefault(); setActive(activeIndex - 1); return; }
    if(e.key === 'Enter'){
      e.preventDefault();
      const r = rows[activeIndex];
      if(r) go(r.dataset.href);
      return;
    }
    if(e.key === 'Tab'){ e.preventDefault(); input.focus(); }   // trap focus in dialog
  }

  function go(href){
    if(!href || href === '#'){ close(); return; }
    close();
    location.href = href;
  }

  function open(){
    if(isOpen) return;
    if(!overlay) build();
    ensureData();
    lastFocused = document.activeElement;
    isOpen = true;
    input.value = '';
    overlay.classList.add('is-open');
    if(!reduceMotion()) overlay.classList.add('is-anim');
    render();
    input.focus();
  }

  function close(){
    if(!isOpen) return;
    isOpen = false;
    overlay.classList.remove('is-open', 'is-anim');
    const target = lastFocused && document.body.contains(lastFocused)
      ? lastFocused
      : document.getElementById('palette-btn');
    if(target && typeof target.focus === 'function') target.focus();
  }

  function toggle(){ isOpen ? close() : open(); }

  // Ctrl+K / ⌘K — don't hijack while the user is typing in some *other* field,
  // and preventDefault so the browser's built-in Ctrl+K can't steal it.
  document.addEventListener('keydown', e => {
    if((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)){
      const t = e.target;
      const editable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' || t.isContentEditable);
      if(editable && (!overlay || !overlay.contains(t))) return;
      e.preventDefault();
      toggle();
    }
  });

  const btn = document.getElementById('palette-btn');
  if(btn) btn.addEventListener('click', open);

  return { open, close, toggle };
}
