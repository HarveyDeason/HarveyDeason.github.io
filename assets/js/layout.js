import { initMode, toggleMode, currentMode } from './mode.js';

const NAV = [
  { key:'tools',   href:'/tools/',   label:'Instruments' },
  { key:'writing', href:'/writing/', label:'Journal' },
  { key:'about',   href:'/about/',   label:'About' },
];

const SUN = '<path d="M12 3v1.5M12 19.5V21M4.2 4.2l1.1 1.1M18.7 18.7l1.1 1.1M3 12h1.5M19.5 12H21M4.2 19.8l1.1-1.1M18.7 5.3l1.1-1.1"/><circle cx="12" cy="12" r="4"/>';
const MOON = '<path d="M20 13A8 8 0 1 1 11 4a6.5 6.5 0 0 0 9 9z"/>';
const SEARCH_ICO = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

export function renderHeader(active = '') {
  const links = NAV.map(n =>
    `<a href="${n.href}"${n.key===active?' aria-current="page"':''}>${n.label}</a>`
  ).join('\n      ');
  return `
  <nav class="nav">
    <div class="container nav-row">
      <a class="logo" href="/"><span class="dot"></span>Harvey Deason</a>
      <div class="nav-links">
      ${links}
      <button class="lamp" id="palette-btn" aria-label="Search — Ctrl+K">${SEARCH_ICO}</button>
      <button class="lamp" id="lamp" aria-label="Toggle evening mode" aria-pressed="false">
        <svg viewBox="0 0 24 24" id="lamp-ico">${SUN}</svg>
      </button>
      <a href="/contact/" class="btn btn-primary nav-cta">Get in touch</a>
      </div>
    </div>
  </nav>`;
}

export function renderFooter() {
  return `
  <div class="container foot">
    <a class="logo" href="/"><span class="dot"></span>Harvey Deason</a>
    <span class="colo">Built by hand<span class="g">·</span>No trackers<span class="g">·</span>United Kingdom</span>
  </div>`;
}

export function mountLayout(active = '') {
  const h = document.getElementById('site-header');
  const f = document.getElementById('site-footer');
  if (h) h.innerHTML = renderHeader(active);
  if (f) f.innerHTML = renderFooter();

  initMode();

  const lamp = document.getElementById('lamp');
  if (lamp) {
    const ico = document.getElementById('lamp-ico');
    const sync = () => {
      const dark = currentMode() === 'dark';
      lamp.setAttribute('aria-pressed', String(dark));
      if (ico) ico.innerHTML = dark ? MOON : SUN;
    };
    sync();
    lamp.addEventListener('click', () => {
      toggleMode();
      sync();
    });
  }
}
