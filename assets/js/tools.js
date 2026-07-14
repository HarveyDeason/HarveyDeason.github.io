const REQUIRED = ['slug','name','blurb','href'];

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// thin-stroke 24×24 icon per tool, keyed by slug (kept out of the JSON manifest)
const ICONS = {
  'naming-validator': '<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M9 13.5l2 2 4-4.5"/>', // document / check
  'hydrosizer':       '<path d="M3 12h4l2-5 3 10 2-5h7"/>',                                    // flow / waveform
  'pid-tag-register': '<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.6"/>',     // tag
  'steelwork-checker':'<path d="M6 4h12M6 20h12M12 4v16M6 12h12"/>',                            // I-beam
  'schedule-sync':    '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="16" y="4" width="5" height="16" rx="1"/><path d="M8 12h8"/>', // sync columns
};
const FALLBACK_ICON = '<rect x="4" y="4" width="16" height="16" rx="2"/>';

function icon(slug){ return `<span class="ico"><svg viewBox="0 0 24 24">${ICONS[slug] || FALLBACK_ICON}</svg></span>`; }

// small padlock beside the № marker for tools gated behind the workshop code
function lockGlyph(){
  return '<span class="lock" aria-label="Locked" title="Locked"><svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/></svg></span>';
}

// bento wide pattern: within each row-group of four, cells 0 and 3 span two columns
function isWide(i){ const m = i % 4; return m === 0 || m === 3; }

export function renderToolCard(t, i = 0){
  const wide = isWide(i) ? ' wide' : '';
  const no = String(i + 1).padStart(2, '0');
  const chips = (t.tags || []).map(tag => `<span class="chip">${esc(tag)}</span>`).join('');
  const meta = chips ? `<span class="meta">${chips}</span>` : '';
  return `<a class="cell${wide}" href="/tools/${esc(t.slug)}.html">
    <span class="no">№ ${no}${t.locked ? lockGlyph() : ''}</span>
    ${icon(t.slug)}
    <h3>${esc(t.name)}</h3>
    <p>${esc(t.blurb)}</p>
    ${meta}
  </a>`;
}

// skeleton placeholders shown while the manifest loads
export function renderSkeletonCells(n = 3){
  let out = '';
  for(let i = 0; i < n; i++){
    out += `<div class="cell${isWide(i) ? ' wide' : ''}" aria-hidden="true">
      <span class="ico skeleton"></span>
      <span class="skeleton" style="height:17px;width:52%"></span>
      <span class="skeleton" style="height:13px;width:92%"></span>
      <span class="skeleton" style="height:13px;width:74%"></span>
    </div>`;
  }
  return out;
}

export async function loadTools(fetchFn = fetch){
  const res = await fetchFn('/data/tools.json');
  if(!res.ok) throw new Error('tools manifest unavailable');
  const data = await res.json();
  data.forEach((t,i)=>{ for(const k of REQUIRED) if(!t[k]) throw new Error(`tool ${i} missing ${k}`); });
  return data;
}

export function mountTools(elId, tools, limit){
  const el = document.getElementById(elId);
  if(!el) return;
  const list = limit ? tools.slice(0, limit) : tools;
  el.innerHTML = list.map((t,i)=>renderToolCard(t,i)).join('');
}
