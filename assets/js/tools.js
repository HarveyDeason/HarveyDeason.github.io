const REQUIRED = ['ref','slug','name','blurb'];

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

export function renderToolCard(t){
  return `<a class="card tool-card" href="/tools/${esc(t.slug)}.html" data-anim="tilt">
    <span class="tool-ref label">${esc(t.ref)}</span>
    <h3>${esc(t.name)}</h3>
    <p>${esc(t.blurb)}</p>
    <span class="tool-open gilt-link">Open ▸</span>
  </a>`;
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
  el.innerHTML = list.map(renderToolCard).join('');
}
