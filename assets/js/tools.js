const REQUIRED = ['ref','slug','name','blurb'];

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// thin-stroke 24×24 icon per tool, keyed by slug (kept out of the JSON manifest)
const ICONS = {
  'hydrosizer':      '<path d="M3 12h4l2-5 3 10 2-5h7"/>',                                    // flow / waveform
  'pipe-hydraulics': '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',                 // gauge
  'pcf-matrix':      '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>', // grid / matrix
  'platform-access': '<path d="M4 20V8l8-4 8 4v12"/><path d="M9 20v-6h6v6"/>',                 // building / access
  'pid-tag-register':'<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.6"/>',     // tag
  'column-merge':    '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="16" y="4" width="5" height="16" rx="1"/><path d="M8 12h8"/>', // merge columns
};
const FALLBACK_ICON = '<rect x="4" y="4" width="16" height="16" rx="2"/>';

function icon(slug){ return `<span class="ico"><svg viewBox="0 0 24 24">${ICONS[slug] || FALLBACK_ICON}</svg></span>`; }

// bento wide pattern: within each row-group of four, cells 0 and 3 span two columns
function isWide(i){ const m = i % 4; return m === 0 || m === 3; }

export function renderToolCard(t, i = 0){
  const wide = isWide(i) ? ' wide' : '';
  const no = String(i + 1).padStart(2, '0');
  const chips = (t.tags || []).map(tag => `<span class="chip">${esc(tag)}</span>`).join('');
  const meta = chips ? `<span class="meta">${chips}</span>` : '';
  return `<a class="cell${wide}" href="/tools/${esc(t.slug)}.html">
    <span class="no">№ ${no}</span>
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
