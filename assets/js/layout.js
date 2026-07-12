const NAV = [
  { key:'tools',   href:'/tools/',   label:'Instruments' },
  { key:'writing', href:'/writing/', label:'Journal' },
  { key:'about',   href:'/about/',   label:'About' },
  { key:'contact', href:'/contact/', label:'Contact' },
];

export function renderHeader(active = '') {
  const links = NAV.map(n =>
    `<a href="${n.href}" class="nav-link"${n.key===active?' aria-current="page"':''}>${n.label}</a>`
  ).join('');
  return `
  <div class="container masthead">
    <a class="brand" href="/" aria-label="Home">
      <img class="seal seal-sm" src="/assets/img/seal.svg" alt="Harvey Deason monogram">
    </a>
    <nav class="nav">${links}</nav>
  </div>`;
}

export function renderFooter() {
  return `
  <div class="container">
    <div class="titleblock">
      <div class="tb-main">
        <div class="tb-name">HARVEY DEASON</div>
        <div class="tb-sub">ENGINEER &amp; ESSAYIST · No. HD—001 · UNITED KINGDOM</div>
      </div>
      <div class="tb-logo"><img class="seal seal-sm" src="/assets/img/seal.svg" alt=""></div>
    </div>
  </div>`;
}

export function mountLayout(active = '') {
  const h = document.getElementById('site-header');
  const f = document.getElementById('site-footer');
  if (h) h.innerHTML = renderHeader(active);
  if (f) f.innerHTML = renderFooter();
}
