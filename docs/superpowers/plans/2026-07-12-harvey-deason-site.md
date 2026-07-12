# Harvey Deason Personal Site — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, heritage-styled personal website for Harvey Deason that houses his 6 engineering tools, pulls his WordPress blog in live, and features an interactive 3D gear-train hero.

**Architecture:** Fully static site — plain HTML, one CSS design system, and small vanilla-JS ES modules (each a single responsibility). No framework, no bundler, no backend. Shared header/footer and dynamic lists (tools, posts) are injected client-side from a JSON manifest and the WordPress public API. Hosted on GitHub Pages.

**Tech Stack:** HTML5, CSS (custom properties), vanilla JavaScript (ES modules), HTML `<canvas>` 2D (hand-rolled 3D), Node's built-in test runner (`node --test`) for pure-logic unit tests, MCP preview server for visual/behavioural verification.

## Global Constraints

Every task's requirements implicitly include these (copied verbatim from the spec):

- **No framework, no build step, no backend.** Ship files run as-is on GitHub Pages.
- **Palette (cream theme):** `--paper:#eee6d0`, `--ink:#2a2620`, `--green:#1c3a2a`, `--gilt:#a9863f`, `--gilt-lt:#cdae6b`, `--oxblood:#6d2a29`, `--soft:#5b5343`.
- **Type:** serif stack `Georgia, 'Palatino Linotype', 'Iowan Old Style', 'Times New Roman', serif`; monospace `ui-monospace, 'Consolas', monospace` for drawing annotations.
- **No external network dependencies** except the WordPress public API. No CDN scripts, fonts, or stylesheets.
- **Gear train:** three gears **14 : 10 : 16** teeth; drag to drive; brass node-cloud on canvas; no 3D library.
- **WordPress source:** `https://public-api.wordpress.com/wp/v2/sites/harveydeason.wordpress.com/posts` (CORS-enabled, `_embed` for media).
- **All motion gated behind `prefers-reduced-motion: reduce`.**
- **Sections (v1):** Home, Tools, Writing, About, Contact. No Projects, no dark theme (fast-follows).
- **Commit after every task.** Conventional commit messages.

---

## File Structure

```
harveydeason-site/
├── index.html                 # Home
├── tools/
│   ├── index.html             # Cabinet (lists from data/tools.json)
│   ├── hydrosizer.html        # T-01  (housed, unchanged internals)
│   ├── pipe-hydraulics.html   # T-02
│   ├── pcf-matrix.html        # T-03
│   ├── platform-access.html   # T-04
│   ├── pid-tag-register.html  # T-05
│   └── column-merge.html      # T-06
├── writing/
│   ├── index.html             # Journal list
│   └── post.html              # Single-post renderer (?slug=)
├── about/index.html
├── contact/index.html
├── data/
│   └── tools.json             # Tools manifest (source of truth)
├── assets/
│   ├── css/site.css           # Heritage design system
│   ├── js/
│   │   ├── layout.js          # renderHeader/renderFooter + mount
│   │   ├── gear-train.js      # gear math + canvas render + drag
│   │   ├── tools.js           # renderToolCard + cabinet/featured mount
│   │   ├── wordpress.js       # fetch + normalize + sanitize + cache + render
│   │   ├── tool-frame.js      # injects slim back-bar into housed tool pages
│   │   └── motion.js          # reveals, tilt, counters, magnetic links
│   └── img/                   # seal.svg, favicon, textures
├── tests/
│   ├── gear-train.test.js
│   ├── tools.test.js
│   └── wordpress.test.js
├── package.json               # { "type":"module", scripts.test: "node --test" }
├── .gitignore
├── .nojekyll                  # let GitHub Pages serve /assets untouched
└── README.md
```

**Testing convention:** Pure functions (gear math, manifest→card HTML string, post normalization, header/footer HTML strings) are exported from their modules and unit-tested with `node --test` (zero dependencies). DOM behaviour, canvas rendering, sanitised HTML injection, responsive layout, and live API calls are verified with the MCP preview server during each task (explicit steps given).

**ES-module rule (critical):** Every module in `assets/js/` must be **side-effect-free at import time** — only declare and `export`. Pages invoke `init*()` functions from a tiny inline `<script type="module">`. This keeps modules importable by Node tests without touching `document`.

---

## Task 1: Repo skeleton + heritage design system

**Files:**
- Create: `package.json`, `.gitignore`, `.nojekyll`, `README.md`, `index.html`, `assets/css/site.css`, `assets/img/seal.svg`

**Interfaces:**
- Produces: the CSS token layer and base components (`.frame`, `.seal`, `.rule`, `.container`, `.eyebrow`, `.wordmark`, `.card`, `.titleblock`) that every later page uses; `site.css` class names are the contract.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "harveydeason-site",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create `.gitignore`, `.nojekyll`, `README.md`**

`.gitignore`:
```
node_modules/
.DS_Store
.superpowers/
```

`.nojekyll`: (empty file — disables Jekyll so `/assets` and dotfiles serve as-is)

`README.md`:
```markdown
# harveydeason.github.io

Personal site of Harvey Deason — Engineer & Essayist.
Static site (no build step). Open `index.html` locally or serve the folder.

- Tools manifest: `data/tools.json`
- Blog source: WordPress.com public API
- Tests: `npm test`
```

- [ ] **Step 3: Create `assets/img/seal.svg`** (the HD monogram roundel)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <circle cx="32" cy="32" r="30" fill="none" stroke="#a9863f" stroke-width="1.2"/>
  <circle cx="32" cy="32" r="25" fill="none" stroke="#1c3a2a" stroke-width="1"/>
  <path d="M14 40 Q10 32 14 24" fill="none" stroke="#a9863f" stroke-width="1"/>
  <path d="M50 40 Q54 32 50 24" fill="none" stroke="#a9863f" stroke-width="1"/>
  <text x="32" y="40" text-anchor="middle" font-family="Georgia, serif" font-weight="700"
        font-size="20" letter-spacing="-2" fill="#1c3a2a">HD</text>
</svg>
```

- [ ] **Step 4: Create `assets/css/site.css`** (design system — tokens + base components)

```css
:root{
  --paper:#eee6d0; --ink:#2a2620; --green:#1c3a2a;
  --gilt:#a9863f; --gilt-lt:#cdae6b; --oxblood:#6d2a29; --soft:#5b5343;
  --serif:Georgia,'Palatino Linotype','Iowan Old Style','Times New Roman',serif;
  --mono:ui-monospace,'Consolas',monospace;
  --maxw:1100px;
}
*{box-sizing:border-box;}
html,body{margin:0;}
body{
  background:var(--paper); color:var(--ink); font-family:var(--serif);
  line-height:1.6; -webkit-font-smoothing:antialiased;
  background-image:repeating-linear-gradient(0deg,rgba(120,100,60,.04) 0 1px,transparent 1px 5px);
}
a{color:var(--green);}
.container{max-width:var(--maxw); margin:0 auto; padding:0 24px;}

/* gilt double-rule frame wrapper for hero/plates */
.frame{position:relative; border:1px solid var(--gilt);}
.frame::before{content:""; position:absolute; inset:6px; border:1px solid rgba(28,58,42,.4); pointer-events:none;}

/* monogram seal */
.seal{width:56px; height:56px; display:inline-block;}

/* ornamental rule */
.rule{display:flex; align-items:center; gap:14px; color:var(--gilt); margin:26px 0;}
.rule .ln{flex:1; height:1px; background:linear-gradient(90deg,transparent,var(--gilt),transparent);}
.rule .di{width:7px; height:7px; background:var(--green); transform:rotate(45deg);}

/* small-caps eyebrow / labels */
.eyebrow{font:400 12px var(--serif); letter-spacing:5px; text-transform:uppercase; color:var(--oxblood);}
.label{font:400 10px 'Segoe UI',sans-serif; letter-spacing:3px; text-transform:uppercase; color:var(--soft);}

/* display wordmark */
.wordmark{font:400 clamp(40px,7vw,92px)/.95 var(--serif); letter-spacing:1px; margin:.15em 0;}
.wordmark em{font-style:italic; color:var(--green);}

/* heritage card */
.card{position:relative; background:rgba(255,252,244,.5); border:1px solid var(--gilt); padding:18px; text-decoration:none; color:inherit; display:block; transition:box-shadow .2s, transform .15s;}
.card::before{content:""; position:absolute; inset:4px; border:1px solid rgba(28,58,42,.35); pointer-events:none;}
.card:hover{box-shadow:0 8px 26px rgba(80,60,20,.18);}
.card h3{margin:.2em 0; font-size:20px; color:var(--green); font-style:italic;}
.card p{margin:0; color:var(--soft); font-size:14px;}

/* title block (footer / contact) */
.titleblock{border:1.6px solid var(--ink); display:grid; grid-template-columns:1fr auto; background:#fff;}
.titleblock .tb-main{padding:10px 14px;}
.titleblock .tb-name{font:800 18px var(--serif); letter-spacing:.3px;}
.titleblock .tb-sub{font:600 9px var(--mono); letter-spacing:1px; color:var(--soft); margin-top:3px;}
.titleblock .tb-logo{display:flex; align-items:center; justify-content:center; border-left:1.6px solid var(--ink); padding:0 12px;}

/* gilt-underline link */
.gilt-link{position:relative; text-decoration:none; color:var(--green); padding-bottom:3px;}
.gilt-link::after{content:""; position:absolute; left:0; right:0; bottom:0; height:1px; background:var(--gilt); transform:scaleX(.3); transform-origin:left; transition:transform .3s;}
.gilt-link:hover::after{transform:scaleX(1);}

@media (prefers-reduced-motion: reduce){
  *{animation:none !important; transition:none !important;}
}
```

- [ ] **Step 5: Create a temporary `index.html` to prove the system renders**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Harvey Deason — Engineer &amp; Essayist</title>
  <link rel="stylesheet" href="/assets/css/site.css">
  <link rel="icon" href="/assets/img/seal.svg">
</head>
<body>
  <div class="container" style="padding-top:60px;">
    <div class="frame" style="padding:40px; text-align:center;">
      <img class="seal" src="/assets/img/seal.svg" alt="HD monogram">
      <div class="eyebrow">Engineer &amp; Essayist</div>
      <div class="wordmark">Harvey <em>Deason</em></div>
      <div class="rule"><div class="ln"></div><div class="di"></div><div class="ln"></div></div>
      <p class="label">Design system online</p>
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 6: Verify in preview**

Create `.claude/launch.json` with a static server config:
```json
{ "version":"0.0.1", "configurations":[
  { "name":"site", "runtimeExecutable":"npx", "runtimeArgs":["-y","serve","-l","5050","."], "port":5050 } ] }
```
Start the server (preview_start "site"), open `/`, take a screenshot.
Expected: cream page, gilt double-frame, HD seal, serif "Harvey *Deason*" wordmark, ornamental rule. No console errors.

- [ ] **Step 7: Initialise git and commit**

```bash
cd harveydeason-site
git init
git add -A
git commit -m "chore: scaffold static site + heritage design system"
```

---

## Task 2: Shared header & footer (layout.js)

**Files:**
- Create: `assets/js/layout.js`, `tests/` entry via `tests/layout.test.js`
- Modify: `index.html` (replace inline header with mounted layout)

**Interfaces:**
- Produces:
  - `renderHeader(active: string): string` — returns header HTML; `active` is one of `"home"|"tools"|"writing"|"about"|"contact"` and marks the current nav link with `aria-current="page"`.
  - `renderFooter(): string` — returns title-block footer HTML.
  - `mountLayout(active: string): void` — injects header into `#site-header` and footer into `#site-footer` (browser only).

- [ ] **Step 1: Write the failing test** — `tests/layout.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHeader, renderFooter } from '../assets/js/layout.js';

test('header contains all nav sections', () => {
  const html = renderHeader('tools');
  for (const label of ['Instruments','Journal','About','Contact'])
    assert.ok(html.includes(label), `missing ${label}`);
});

test('header marks the active section', () => {
  assert.ok(renderHeader('tools').includes('aria-current="page"'));
  assert.match(renderHeader('tools'), /aria-current="page"[^>]*>\s*Instruments/);
});

test('footer renders the title block name', () => {
  assert.ok(renderFooter().includes('HARVEY DEASON'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../assets/js/layout.js`.

- [ ] **Step 3: Implement `assets/js/layout.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 tests).

- [ ] **Step 5: Add header/footer styling to `assets/css/site.css`**

```css
.masthead{display:flex; align-items:center; justify-content:space-between; padding-top:22px; padding-bottom:22px;}
.seal-sm{width:40px; height:40px;}
.nav{display:flex; gap:28px;}
.nav-link{color:var(--soft); text-decoration:none; font:400 12px var(--serif); letter-spacing:3px; text-transform:uppercase; padding-bottom:4px; border-bottom:1px solid transparent; transition:.25s;}
.nav-link:hover,.nav-link[aria-current="page"]{color:var(--green); border-bottom-color:var(--gilt);}
#site-footer{margin-top:80px; padding:30px 0;}
```

- [ ] **Step 6: Wire layout into `index.html`**

Add `<header id="site-header"></header>` at top of `<body>`, `<footer id="site-footer"></footer>` at the end, and before `</body>`:
```html
<script type="module">
  import { mountLayout } from '/assets/js/layout.js';
  mountLayout('home');
</script>
```

- [ ] **Step 7: Verify in preview**

Reload `/`. Expected: heritage header (seal + Instruments/Journal/About/Contact) and title-block footer both render; no console errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: shared heritage header and footer via layout.js"
```

---

## Task 3: Gear-train module (gear-train.js)

**Files:**
- Create: `assets/js/gear-train.js`, `tests/gear-train.test.js`

**Interfaces:**
- Produces:
  - `GEAR_CONFIG = { gears:[{Z:14},{Z:10},{Z:16}], module:0.85 }` (exported default config).
  - `pitch(Z:number, module:number): number` — pitch radius `= module*Z/2`.
  - `toothRadius(u:number, Z:number, module:number): number` — radius at fractional angle `u∈[0,1)`; adds addendum on a tooth, subtracts dedendum in a gap.
  - `gearAngles(phi:number, cfg): [number,number,number]` — body angles for the 3 gears given drive angle `phi`; enforces ratio `-(Z_driver/Z_driven)` per mesh.
  - `initGearTrain(canvas: HTMLCanvasElement, opts?): void` — mounts the interactive render (browser only).

- [ ] **Step 1: Write the failing test** — `tests/gear-train.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pitch, toothRadius, gearAngles, GEAR_CONFIG } from '../assets/js/gear-train.js';

test('pitch radius = module*Z/2', () => {
  assert.equal(pitch(14, 0.85), 0.85*14/2);
});

test('a tooth sits further out than a gap', () => {
  const p = pitch(10, 0.85);
  const toothU = 0.0;   // frac(u*Z)=0 -> tooth
  const gapU   = 0.05;  // frac(0.05*10)=0.5 -> gap
  assert.ok(toothRadius(toothU, 10, 0.85) > p);
  assert.ok(toothRadius(gapU, 10, 0.85) < p);
});

test('gearAngles enforces mesh ratios and directions', () => {
  const a0 = gearAngles(0, GEAR_CONFIG);
  const a1 = gearAngles(0.1, GEAR_CONFIG);
  const [ZA,ZB,ZC] = GEAR_CONFIG.gears.map(g=>g.Z);
  const rAB = (a1[1]-a0[1])/(a1[0]-a0[0]);
  const rBC = (a1[2]-a0[2])/(a1[1]-a0[1]);
  assert.ok(Math.abs(rAB - (-(ZA/ZB))) < 1e-9, `A→B ratio ${rAB}`);
  assert.ok(Math.abs(rBC - (-(ZB/ZC))) < 1e-9, `B→C ratio ${rBC}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `gear-train.js`.

- [ ] **Step 3: Implement pure math + config in `assets/js/gear-train.js`**

```js
const TWO = Math.PI * 2;

export const GEAR_CONFIG = {
  module: 0.85,
  gears: [{ Z:14 }, { Z:10 }, { Z:16 }],
  betaBC: 0.96,          // placement angle of gear C relative to B
};

export function pitch(Z, module) { return module * Z / 2; }

export function toothRadius(u, Z, module) {
  const p = pitch(Z, module);
  const frac = ((u * Z) % 1 + 1) % 1;
  const tooth = frac < 0.36;                 // teeth thinner than gaps → clearance
  return p + (tooth ? 0.55 * module : -0.7 * module);
}

// meshing phase so a tooth of the driver sits in a gap of the driven gear
function meshPhase(beta, Zd, Zdriven) {
  const target = 0.72;
  return beta + Math.PI - (TWO / Zdriven) * (target - (beta / TWO) * Zd);
}

export function gearAngles(phi, cfg = GEAR_CONFIG) {
  const [A, B, C] = cfg.gears.map(g => g.Z);
  // centres: A at origin, B to the right, C up-right of B
  const betaAB = 0;
  const cB = meshPhase(betaAB, A, B);
  const cC = meshPhase(cfg.betaBC, B, C);
  const aA = phi;
  const aB = -(A / B) * aA + cB;
  const aC = -(B / C) * aB + cC;
  return [aA, aB, aC];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Append the interactive renderer to `assets/js/gear-train.js`**

```js
// ---- interactive render (browser only) ----
export function initGearTrain(canvas, opts = {}) {
  const cfg = opts.config || GEAR_CONFIG;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const gears = cfg.gears.map(g => ({ ...g }));
  gears[0].cx = 0; gears[0].cy = 0;
  gears[1].cx = pitch(gears[0].Z,cfg.module)+pitch(gears[1].Z,cfg.module); gears[1].cy = 0;
  const dBC = pitch(gears[1].Z,cfg.module)+pitch(gears[2].Z,cfg.module);
  gears[2].cx = gears[1].cx + Math.cos(cfg.betaBC)*dBC;
  gears[2].cy = gears[1].cy + Math.sin(cfg.betaBC)*dBC;
  const mxc=(gears[0].cx+gears[1].cx+gears[2].cx)/3, myc=(gears[0].cy+gears[1].cy+gears[2].cy)/3;
  gears.forEach(g=>{g.cx-=mxc; g.cy-=myc;});

  // build node cloud per gear (toothed wall + two faces)
  const nodes=[], edges=[]; const half=0.95, hub=1.4;
  const density = opts.density || 3;
  function addPatch(gi, U, V, fn, wrapU){
    const grid=[];
    for(let i=0;i<U;i++){grid[i]=[];for(let j=0;j<V;j++){
      const u=i/(wrapU?U:(U-1)), v=j/(V-1); const p=fn(u,v);
      grid[i][j]=nodes.length; nodes.push({lx:p.x,ly:p.y,lz:p.z,g:gi,seed:p.seed});
    }}
    for(let i=0;i<U;i++)for(let j=0;j<V;j++){
      if(i<U-1||wrapU) edges.push([grid[i][j],grid[(i+1)%U][j]]);
      if(j<V-1) edges.push([grid[i][j],grid[i][j+1]]);
    }
  }
  gears.forEach((g,gi)=>{
    const U=g.Z*density;
    addPatch(gi,U,3,(u,v)=>{const a=u*TWO,r=toothRadius(u,g.Z,cfg.module);return{x:Math.cos(a)*r,y:Math.sin(a)*r,z:(v-0.5)*2*half,seed:.55};},true);
    addPatch(gi,U,4,(u,v)=>{const a=u*TWO,r=hub+(toothRadius(u,g.Z,cfg.module)-hub)*v;return{x:Math.cos(a)*r,y:Math.sin(a)*r,z:half,seed:.35};},true);
    addPatch(gi,U,4,(u,v)=>{const a=u*TWO,r=hub+(toothRadius(u,g.Z,cfg.module)-hub)*v;return{x:Math.cos(a)*r,y:Math.sin(a)*r,z:-half,seed:.35};},true);
  });

  function size(){const r=canvas.getBoundingClientRect();canvas._w=r.width;canvas._h=r.height;canvas.width=r.width*dpr;canvas.height=r.height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}
  size(); window.addEventListener('resize', size);

  let phi=0, vel=0, drag=false, lastX=0, mvx=0, mvy=0, tilt=0.62, viewY=0;
  canvas.addEventListener('pointerdown',e=>{drag=true;lastX=e.clientX;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{ if(drag){vel+=(e.clientX-lastX)*0.0016;lastX=e.clientX;} const r=canvas.getBoundingClientRect(); mvx=(e.clientX-r.left)/r.width-.5; mvy=(e.clientY-r.top)/r.height-.5; });
  canvas.addEventListener('pointerup',()=>drag=false);
  canvas.addEventListener('pointercancel',()=>drag=false);

  const range=15.5;
  function frame(){
    const W=canvas._w,H=canvas._h,cx=W/2,cy=H/2,FOV=52,S=Math.min(W,H)/(2.5*range);
    vel*=0.94; phi += vel + (reduce?0:0.0045);
    const ang=gearAngles(phi,cfg);
    const ax=tilt+mvy*0.5; viewY += (mvx*0.6 - viewY)*0.06;
    const cX=Math.cos(ax),sX=Math.sin(ax),cVY=Math.cos(viewY),sVY=Math.sin(viewY);
    const cA=ang.map(Math.cos), sA=ang.map(Math.sin);
    ctx.clearRect(0,0,W,H);
    for(const o of nodes){
      const x0=o.lx*cA[o.g]-o.ly*sA[o.g], y0=o.lx*sA[o.g]+o.ly*cA[o.g], z0=o.lz;
      const x=x0+gears[o.g].cx, y=y0+gears[o.g].cy;
      const x2=x*cVY+z0*sVY, z2=-x*sVY+z0*cVY;
      const y2=y*cX-z2*sX, z3=y*sX+z2*cX;
      const sc=FOV/(FOV+z3);
      o.sx=cx+x2*sc*S; o.sy=cy+y2*sc*S; o.pz=z3; o.sc=sc;
    }
    for(const [i,j] of edges){const a=nodes[i],b=nodes[j];const d=(a.pz+range)/(2*range);
      ctx.strokeStyle=`rgba(40,38,32,${0.05+d*0.15})`; ctx.lineWidth=0.4+d*0.4;
      ctx.beginPath();ctx.moveTo(a.sx,a.sy);ctx.lineTo(b.sx,b.sy);ctx.stroke();}
    for(const p of [...nodes].sort((m,n)=>m.pz-n.pz)){const d=(p.pz+range)/(2*range);const rad=(0.7+p.seed*1.1)*p.sc*1.05;
      if(d>0.82){ctx.fillStyle='rgba(169,134,63,0.08)';ctx.beginPath();ctx.arc(p.sx,p.sy,rad*2.2,0,7);ctx.fill();}
      ctx.fillStyle=`rgba(${150+d*56},${116+d*42},${48+d*34},${0.32+d*0.6})`;
      ctx.beginPath();ctx.arc(p.sx,p.sy,rad,0,7);ctx.fill();}
    if(!(reduce && Math.abs(vel)<1e-4)) requestAnimationFrame(frame);
  }
  frame();
}
```

- [ ] **Step 6: Verify render in a scratch page**

Temporarily add to `index.html` a `<canvas id="gt" style="width:100%;height:420px"></canvas>` and inline module `import{initGearTrain}from '/assets/js/gear-train.js'; initGearTrain(document.getElementById('gt'));`. Reload `/`, screenshot.
Expected: three brass node-cloud gears on cream; dragging left/right drives all three (opposite neighbours, 10-tooth fastest); idle slow drift; no console errors. Remove the scratch canvas afterward (Home builds its own in Task 4).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: interactive gear-train module with tested meshing math"
```

---

## Task 4: Home page (hero + section shells)

**Files:**
- Modify/Create: `index.html`

**Interfaces:**
- Consumes: `mountLayout` (Task 2), `initGearTrain` (Task 3).
- Produces: mount points `#featured-tools` and `#latest-writing` (filled in Task 7); `data-anim` attributes consumed by `motion.js` (Task 10).

- [ ] **Step 1: Replace `index.html` body with the Home layout**

```html
<body>
  <header id="site-header"></header>
  <main>
    <section class="hero container">
      <div class="frame hero-frame">
        <span class="rc tl"></span><span class="rc tr"></span><span class="rc bl"></span><span class="rc br"></span>
        <div class="hero-grid">
          <div class="hero-copy">
            <div class="eyebrow">Engineer &amp; Essayist</div>
            <h1 class="wordmark">Harvey <em>Deason</em></h1>
            <div class="dim"><span class="tick"></span><span class="ln"></span><span class="val">ENGINEERING &amp; WRITING</span><span class="ln"></span><span class="tick"></span></div>
            <p class="lead">A cabinet of engineering instruments, built by hand — and a journal on work, output, and the well-considered life.</p>
            <div class="hero-cta">
              <a class="gilt-link" href="/tools/">Enter the Cabinet →</a>
              <a class="gilt-link" href="/writing/">Read the Journal →</a>
            </div>
          </div>
          <div class="hero-plate">
            <canvas id="gear-train" aria-label="Interactive three-gear train illustration"></canvas>
            <div class="label plate-cap">Plate I · The Gear Train — drag to drive</div>
          </div>
        </div>
      </div>
    </section>

    <section class="container section" data-anim="reveal">
      <div class="rule"><div class="ln"></div><div class="di"></div><div class="ln"></div></div>
      <h2 class="section-title">From the Journal</h2>
      <div id="latest-writing" class="cards-grid">Loading…</div>
    </section>

    <section class="container section" data-anim="reveal">
      <div class="rule"><div class="ln"></div><div class="di"></div><div class="ln"></div></div>
      <h2 class="section-title">Instruments</h2>
      <div id="featured-tools" class="cards-grid">Loading…</div>
    </section>
  </main>
  <footer id="site-footer"></footer>

  <script type="module">
    import { mountLayout } from '/assets/js/layout.js';
    import { initGearTrain } from '/assets/js/gear-train.js';
    mountLayout('home');
    initGearTrain(document.getElementById('gear-train'));
  </script>
</body>
```

- [ ] **Step 2: Add Home styles to `assets/css/site.css`**

```css
.hero{padding-top:30px;}
.hero-frame{padding:40px;}
.hero-grid{display:grid; grid-template-columns:1fr 1fr; gap:24px; align-items:center;}
.hero-copy .lead{font:italic 400 18px/1.55 var(--serif); color:var(--soft); max-width:440px;}
.hero-cta{display:flex; gap:28px; margin-top:26px;}
.hero-plate canvas{width:100%; aspect-ratio:1.2/1; display:block; cursor:ew-resize;}
.plate-cap{text-align:center; margin-top:8px;}
.dim{display:flex; align-items:center; gap:0; margin:14px 0 18px; color:var(--gilt); height:16px;}
.dim .tick{width:1px; height:12px; background:var(--gilt);}
.dim .ln{flex:1; height:1px; background:var(--gilt);}
.dim .val{font:600 10px var(--mono); color:var(--gilt); padding:0 8px; white-space:nowrap;}
.rc{position:absolute; width:16px; height:16px; border:1.5px solid rgba(169,134,63,.5);}
.rc.tl{top:14px;left:14px;border-right:none;border-bottom:none;}
.rc.tr{top:14px;right:14px;border-left:none;border-bottom:none;}
.rc.bl{bottom:14px;left:14px;border-right:none;border-top:none;}
.rc.br{bottom:14px;right:14px;border-left:none;border-top:none;}
.section{margin-top:60px;}
.section-title{font:italic 400 26px var(--serif); color:var(--green); text-align:center;}
.cards-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:18px; margin-top:20px;}
@media (max-width:720px){ .hero-grid{grid-template-columns:1fr;} }
```

- [ ] **Step 3: Verify in preview**

Reload `/`. Screenshot desktop + mobile (preview_resize mobile).
Expected: hero with copy left, gear train right (drag works); two section shells "From the Journal" / "Instruments" showing "Loading…"; footer present; single-column on mobile; no console errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: home page hero with gear-train and section shells"
```

---

## Task 5: Tools manifest + cabinet (tools.js)

**Files:**
- Create: `data/tools.json`, `assets/js/tools.js`, `tools/index.html`, `tests/tools.test.js`

**Interfaces:**
- Produces:
  - `renderToolCard(tool): string` — heritage card HTML for one manifest entry.
  - `loadTools(fetchFn=fetch): Promise<Tool[]>` — fetches & validates `data/tools.json`.
  - `mountTools(elId, tools, limit?): void` — renders cards into an element (browser).
  - `Tool` shape: `{ ref, slug, name, blurb, discipline, type, status }`.

- [ ] **Step 1: Create `data/tools.json`**

```json
[
  { "ref":"T-01","slug":"hydrosizer","name":"HydroSizer","blurb":"Storage tank sizing for process water.","discipline":"Process","type":"Sizing","status":"live" },
  { "ref":"T-02","slug":"pipe-hydraulics","name":"Pipe Hydraulics Calculator","blurb":"Flow, velocity and head-loss for pipe runs.","discipline":"Mechanical","type":"Calculator","status":"live" },
  { "ref":"T-03","slug":"pcf-matrix","name":"PCF Selection Matrix","blurb":"Guided process component selection.","discipline":"Process","type":"Selector","status":"live" },
  { "ref":"T-04","slug":"platform-access","name":"Platform Access Checker","blurb":"Access & platform compliance checks.","discipline":"Civil","type":"Checker","status":"live" },
  { "ref":"T-05","slug":"pid-tag-register","name":"P&ID Tag Register","blurb":"Build and manage P&ID tag registers.","discipline":"Process","type":"Register","status":"live" },
  { "ref":"T-06","slug":"column-merge","name":"Column Merge","blurb":"Match on a key column, transfer selected columns between spreadsheets.","discipline":"Data","type":"Utility","status":"live" }
]
```

- [ ] **Step 2: Write the failing test** — `tests/tools.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToolCard, loadTools } from '../assets/js/tools.js';

const tool = { ref:'T-01', slug:'hydrosizer', name:'HydroSizer', blurb:'Tank sizing.', discipline:'Process', type:'Sizing', status:'live' };

test('renderToolCard links to the tool page and shows name + ref', () => {
  const html = renderToolCard(tool);
  assert.ok(html.includes('href="/tools/hydrosizer.html"'));
  assert.ok(html.includes('HydroSizer'));
  assert.ok(html.includes('T-01'));
});

test('renderToolCard escapes ampersands in names', () => {
  const html = renderToolCard({ ...tool, name:'P&ID Tag Register', slug:'pid-tag-register' });
  assert.ok(html.includes('P&amp;ID'));
  assert.ok(!html.includes('P&ID'));
});

test('loadTools validates required fields', async () => {
  const fakeFetch = async () => ({ ok:true, json: async () => ([{ ref:'X' }]) });
  await assert.rejects(() => loadTools(fakeFetch), /missing/i);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `tools.js`.

- [ ] **Step 4: Implement `assets/js/tools.js`**

```js
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Build `tools/index.html` (the cabinet)**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Instruments — Harvey Deason</title>
  <link rel="stylesheet" href="/assets/css/site.css">
  <link rel="icon" href="/assets/img/seal.svg">
</head>
<body>
  <header id="site-header"></header>
  <main class="container">
    <section class="section" style="margin-top:40px;">
      <div class="eyebrow" style="text-align:center;">The Instrument Cabinet</div>
      <h1 class="section-title">Engineering Instruments</h1>
      <p class="lead" style="text-align:center;margin:0 auto;max-width:520px;color:var(--soft);font-style:italic;">Self-serve tools that run in your browser. Nothing to install.</p>
      <div id="tool-cabinet" class="cards-grid" style="margin-top:30px;">Loading…</div>
    </section>
  </main>
  <footer id="site-footer"></footer>
  <script type="module">
    import { mountLayout } from '/assets/js/layout.js';
    import { loadTools, mountTools } from '/assets/js/tools.js';
    mountLayout('tools');
    loadTools().then(t => mountTools('tool-cabinet', t))
      .catch(() => { document.getElementById('tool-cabinet').innerHTML =
        '<p class="label">The cabinet is momentarily unavailable.</p>'; });
  </script>
</body>
</html>
```

- [ ] **Step 7: Add tool-card styles to `assets/css/site.css`**

```css
.tool-card{display:flex; flex-direction:column; min-height:150px;}
.tool-ref{position:absolute; top:10px; right:12px;}
.tool-open{margin-top:auto; align-self:flex-start;}
```

- [ ] **Step 8: Verify in preview**

Open `/tools/`. Expected: 6 heritage cards (HydroSizer … Column Merge), each with ref, blurb, "Open ▸"; header marks "Instruments" active; no console errors. (Cards link to pages created in Task 6 — links 404 until then; that's expected.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: tools manifest and instrument cabinet"
```

---

## Task 6: House the 6 tool files + shared back-bar (tool-frame.js)

**Files:**
- Create: `assets/js/tool-frame.js`, and the 6 files `tools/hydrosizer.html`, `tools/pipe-hydraulics.html`, `tools/pcf-matrix.html`, `tools/platform-access.html`, `tools/pid-tag-register.html`, `tools/column-merge.html` (copied from Harvey's originals).

**Interfaces:**
- Consumes: nothing (self-contained bar).
- Produces: a fixed top back-bar injected into any page that includes `tool-frame.js`.

**Source files to copy (latest revision of each):**
- `C:/Users/deaso/VS Code/Tank_Sizing/hydrosizer_redesign.html` → `tools/hydrosizer.html`
- `C:/Users/deaso/VS Code/PCF/pipe-hydraulics-calculator.html` → `tools/pipe-hydraulics.html`
- `C:/Users/deaso/VS Code/PCF/pcf-selection-matrix.html` → `tools/pcf-matrix.html`
- `C:/Users/deaso/VS Code/PCF/platform-access-checker.html` → `tools/platform-access.html`
- `C:/Users/deaso/Downloads/pid-tag-register_<highest>.html` → `tools/pid-tag-register.html`
- `C:/Users/deaso/Downloads/gemini-code-<highest>.html` → `tools/column-merge.html`

- [ ] **Step 1: Implement `assets/js/tool-frame.js`** (namespaced, won't touch tool internals)

```js
(function(){
  const bar = document.createElement('div');
  bar.id = 'hd-toolbar';
  bar.innerHTML =
    '<a href="/tools/" class="hd-back">← The Cabinet</a>' +
    '<a href="/" class="hd-home"><span>HARVEY DEASON</span></a>' +
    '<a href="/writing/" class="hd-journal">Journal</a>';
  const style = document.createElement('style');
  style.textContent =
    '#hd-toolbar{position:sticky;top:0;z-index:99999;display:flex;align-items:center;justify-content:space-between;'
    + 'gap:16px;padding:8px 16px;background:#eee6d0;border-bottom:1px solid #a9863f;'
    + "font-family:Georgia,serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;}"
    + '#hd-toolbar a{color:#1c3a2a;text-decoration:none;}'
    + '#hd-toolbar .hd-home span{font-weight:700;letter-spacing:1px;}';
  document.head.appendChild(style);
  document.body.insertBefore(bar, document.body.firstChild);
})();
```

- [ ] **Step 2: Copy the 6 source files** into `tools/` with the target names above (verbatim; do not alter their internal markup/logic).

- [ ] **Step 3: Add the back-bar include to each tool file**

In each of the 6 files, insert immediately before `</body>`:
```html
<script src="/assets/js/tool-frame.js"></script>
```

- [ ] **Step 4: Verify each tool in preview**

For each of the 6 pages (`/tools/hydrosizer.html`, …): open it, confirm the heritage back-bar appears at the top, the "← The Cabinet" link works, and the tool's own UI still renders and functions (interact with one input per tool). Check console for errors introduced by the include.
Expected: bar present on all 6; tools function unchanged; no new console errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: house 6 engineering tools with shared heritage back-bar"
```

---

## Task 7: Wire Home dynamic sections

**Files:**
- Modify: `index.html` (home module script)

**Interfaces:**
- Consumes: `loadTools`/`mountTools` (Task 5), `fetchPosts`/`renderPostCard`/`mountPosts` (Task 8 — build Task 8 before this step, or stub then fill).

- [ ] **Step 1: Update the Home module script** in `index.html`

```html
<script type="module">
  import { mountLayout } from '/assets/js/layout.js';
  import { initGearTrain } from '/assets/js/gear-train.js';
  import { loadTools, mountTools } from '/assets/js/tools.js';
  import { fetchPosts, mountPosts } from '/assets/js/wordpress.js';
  mountLayout('home');
  initGearTrain(document.getElementById('gear-train'));
  loadTools().then(t => mountTools('featured-tools', t, 3))
    .catch(()=>{ document.getElementById('featured-tools').innerHTML='<p class="label">Instruments unavailable.</p>'; });
  fetchPosts({ perPage:3 }).then(p => mountPosts('latest-writing', p))
    .catch(()=>{ document.getElementById('latest-writing').innerHTML='<p class="label">The journal is momentarily unavailable. <a class="gilt-link" href="https://harveydeason.wordpress.com/">Read on WordPress →</a></p>'; });
</script>
```

- [ ] **Step 2: Verify in preview**

Reload `/`. Expected: "From the Journal" shows 3 real WordPress posts; "Instruments" shows 3 tool cards; gear train still runs; graceful fallbacks if offline. No console errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: wire live posts and featured tools into home"
```

> **Ordering note:** implement Task 8 (wordpress.js) before executing this task's Step 2.

---

## Task 8: WordPress module (wordpress.js) + Writing pages

**Files:**
- Create: `assets/js/wordpress.js`, `writing/index.html`, `writing/post.html`, `tests/wordpress.test.js`

**Interfaces:**
- Produces:
  - `normalizePost(apiObj): Post` — `Post = { id, slug, dateISO, title, excerpt, cover, html }`.
  - `fetchPosts({perPage, fetchFn}): Promise<Post[]>` — list (uses `_embed`, cache).
  - `fetchPostBySlug(slug, fetchFn): Promise<Post|null>`.
  - `renderPostCard(post): string` — journal list card.
  - `sanitizeHtml(html): string` — allowlist sanitiser (browser DOM-based).
  - `mountPosts(elId, posts): void`, `mountSinglePost(elId, post): void`.

- [ ] **Step 1: Write the failing test** — `tests/wordpress.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePost, renderPostCard } from '../assets/js/wordpress.js';

const api = {
  id: 42, slug: 'weekly-waffle-19', date: '2026-01-10T09:00:00',
  title: { rendered: 'Weekly Waffle #19 &#8211; The Life of a Camel' },
  excerpt: { rendered: '<p>On Nietzsche&#8217;s camel.</p>' },
  content: { rendered: '<p>Body <strong>text</strong>.</p>' },
  _embedded: { 'wp:featuredmedia': [{ source_url: 'https://img/cover.jpg' }] }
};

test('normalizePost extracts and decodes fields', () => {
  const p = normalizePost(api);
  assert.equal(p.id, 42);
  assert.equal(p.slug, 'weekly-waffle-19');
  assert.equal(p.title, 'Weekly Waffle #19 – The Life of a Camel');
  assert.equal(p.cover, 'https://img/cover.jpg');
  assert.ok(p.excerpt.includes('camel'));
  assert.ok(!p.excerpt.includes('<p>'));      // excerpt is plain text
  assert.ok(p.html.includes('<strong>'));     // full html retained (pre-sanitise)
});

test('normalizePost tolerates missing featured media', () => {
  const p = normalizePost({ ...api, _embedded: {} });
  assert.equal(p.cover, null);
});

test('renderPostCard links to the in-site post reader', () => {
  const html = renderPostCard(normalizePost(api));
  assert.ok(html.includes('href="/writing/post.html?slug=weekly-waffle-19"'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `wordpress.js`.

- [ ] **Step 3: Implement pure parts of `assets/js/wordpress.js`**

```js
const SITE = 'harveydeason.wordpress.com';
const BASE = `https://public-api.wordpress.com/wp/v2/sites/${SITE}/posts`;

const ENTITIES = { '&amp;':'&','&#038;':'&','&#8211;':'–','&#8212;':'—','&#8217;':'’','&#8216;':'‘','&#8220;':'“','&#8221;':'”','&#8230;':'…','&hellip;':'…','&nbsp;':' ' };
function decode(s){ return String(s||'').replace(/&#?\w+;/g, m => ENTITIES[m] ?? m); }
function stripTags(s){ return decode(String(s||'').replace(/<[^>]*>/g,'')).trim(); }

export function normalizePost(o){
  const media = o._embedded && o._embedded['wp:featuredmedia'];
  return {
    id: o.id,
    slug: o.slug,
    dateISO: o.date,
    title: decode(o.title?.rendered ?? ''),
    excerpt: stripTags(o.excerpt?.rendered ?? ''),
    cover: (media && media[0] && media[0].source_url) || null,
    html: o.content?.rendered ?? '',
  };
}

function fmtDate(iso){ try { return new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}); } catch { return ''; } }

export function renderPostCard(p){
  const cover = p.cover ? `<div class="post-cover" style="background-image:url('${p.cover}')"></div>` : '';
  return `<a class="card post-card" href="/writing/post.html?slug=${encodeURIComponent(p.slug)}" data-anim="tilt">
    ${cover}
    <span class="label">${fmtDate(p.dateISO)}</span>
    <h3>${p.title}</h3>
    <p>${p.excerpt}</p>
  </a>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Append fetch, cache, sanitiser, and mounts to `assets/js/wordpress.js`**

```js
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
export function sanitizeHtml(html){
  const tpl = document.createElement('template'); tpl.innerHTML = html;
  (function walk(node){
    [...node.childNodes].forEach(n=>{
      if(n.nodeType===1){
        if(!ALLOWED.has(n.tagName)){ n.replaceWith(...n.childNodes); return; }
        [...n.attributes].forEach(a=>{ if(!(ATTRS[n.tagName]||[]).includes(a.name)) n.removeAttribute(a.name); });
        if(n.tagName==='A'){ n.setAttribute('rel','noopener'); if(/^https?:/.test(n.getAttribute('href')||'')===false && !(n.getAttribute('href')||'').startsWith('/')) n.removeAttribute('href'); }
        walk(n);
      } else if(n.nodeType!==3){ n.remove(); }
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
  const cover = post.cover ? `<img class="post-hero" src="${post.cover}" alt="">` : '';
  el.innerHTML = `<article class="post">
    <div class="label">${new Date(post.dateISO).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</div>
    <h1 class="post-title">${post.title}</h1>
    ${cover}
    <div class="post-body">${sanitizeHtml(post.html)}</div>
  </article>`;
}
```

- [ ] **Step 6: Build `writing/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Journal — Harvey Deason</title>
  <link rel="stylesheet" href="/assets/css/site.css"><link rel="icon" href="/assets/img/seal.svg">
</head>
<body>
  <header id="site-header"></header>
  <main class="container">
    <section class="section" style="margin-top:40px;">
      <div class="eyebrow" style="text-align:center;">The Journal</div>
      <h1 class="section-title">Writing</h1>
      <div id="journal" class="cards-grid" style="margin-top:30px;">Loading…</div>
    </section>
  </main>
  <footer id="site-footer"></footer>
  <script type="module">
    import { mountLayout } from '/assets/js/layout.js';
    import { fetchPosts, mountPosts } from '/assets/js/wordpress.js';
    mountLayout('writing');
    fetchPosts({ perPage: 20 }).then(p => mountPosts('journal', p))
      .catch(()=>{ document.getElementById('journal').innerHTML =
        '<p class="label">The journal is momentarily unavailable. <a class="gilt-link" href="https://harveydeason.wordpress.com/">Read on WordPress →</a></p>'; });
  </script>
</body>
</html>
```

- [ ] **Step 7: Build `writing/post.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Journal — Harvey Deason</title>
  <link rel="stylesheet" href="/assets/css/site.css"><link rel="icon" href="/assets/img/seal.svg">
</head>
<body>
  <header id="site-header"></header>
  <main class="container reading">
    <p><a class="gilt-link" href="/writing/">← Back to the Journal</a></p>
    <div id="post">Loading…</div>
  </main>
  <footer id="site-footer"></footer>
  <script type="module">
    import { mountLayout } from '/assets/js/layout.js';
    import { fetchPostBySlug, mountSinglePost } from '/assets/js/wordpress.js';
    mountLayout('writing');
    const slug = new URLSearchParams(location.search).get('slug');
    fetchPostBySlug(slug).then(p => mountSinglePost('post', p))
      .catch(()=>{ document.getElementById('post').innerHTML =
        '<p class="label">Unable to load this post. <a class="gilt-link" href="https://harveydeason.wordpress.com/">Read on WordPress →</a></p>'; });
  </script>
</body>
</html>
```

- [ ] **Step 8: Add writing styles to `assets/css/site.css`**

```css
.post-cover{height:140px; background-size:cover; background-position:center; margin:-18px -18px 12px; border-bottom:1px solid var(--gilt);}
.post-card h3{font-size:19px;}
.reading{max-width:720px; margin-top:40px;}
.post-title{font:400 clamp(30px,5vw,50px)/1.1 var(--serif); color:var(--ink); margin:.2em 0 .4em;}
.post-hero{width:100%; border:1px solid var(--gilt); margin:10px 0 20px;}
.post-body{font-size:18px; line-height:1.75;}
.post-body p:first-of-type::first-letter{float:left; font:400 54px/.8 var(--serif); color:var(--green); padding:6px 10px 0 0;}
.post-body img{max-width:100%; height:auto;}
.post-body h2,.post-body h3{color:var(--green); font-style:italic;}
.post-body blockquote{border-left:3px solid var(--gilt); margin:1em 0; padding-left:1em; color:var(--soft); font-style:italic;}
```

- [ ] **Step 9: Verify in preview**

Open `/writing/` — real posts list. Click one → `/writing/post.html?slug=…` renders the full post in heritage style (drop-cap, serif body, images). Test the offline fallback by blocking the request (or note expected fallback text). No console errors; verify no `<script>`/`<style>`/`onclick` survive in rendered post (sanitiser).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: WordPress module + journal list and in-site post reader"
```

---

## Task 9: About page

**Files:**
- Create: `about/index.html`

**Interfaces:**
- Consumes: `mountLayout`, optionally `initGearTrain` (small motif canvas).

- [ ] **Step 1: Build `about/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>About — Harvey Deason</title>
  <link rel="stylesheet" href="/assets/css/site.css"><link rel="icon" href="/assets/img/seal.svg">
</head>
<body>
  <header id="site-header"></header>
  <main class="container reading">
    <div class="eyebrow">About</div>
    <h1 class="wordmark" style="font-size:clamp(34px,6vw,64px);">Harvey <em>Deason</em></h1>
    <div class="rule"><div class="ln"></div><div class="di"></div><div class="ln"></div></div>
    <div class="post-body" data-anim="reveal">
      <p>Harvey Deason is a design engineer working in the water industry, and an essayist who writes on work, output, and the well-considered life.</p>
      <p>This site is his workshop and his journal in one place: a cabinet of engineering instruments he builds and gives away, alongside a weekly journal of essays.</p>
      <p>The tools are practical, browser-based, and free to use. The writing is thinking-in-progress.</p>
    </div>
  </main>
  <footer id="site-footer"></footer>
  <script type="module">
    import { mountLayout } from '/assets/js/layout.js';
    mountLayout('about');
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify in preview**

Open `/about/`. Expected: heritage About page, "About" nav active, readable measure, footer present. No console errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: about page"
```

> **Copy note for implementer:** the three body paragraphs are placeholder-quality prose that is factually safe; flag to Harvey for a personal rewrite, but they are complete and shippable as written.

---

## Task 10: Contact page (title-block styled)

**Files:**
- Create: `contact/index.html`

- [ ] **Step 1: Build `contact/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Contact — Harvey Deason</title>
  <link rel="stylesheet" href="/assets/css/site.css"><link rel="icon" href="/assets/img/seal.svg">
</head>
<body>
  <header id="site-header"></header>
  <main class="container reading" style="text-align:center;">
    <div class="eyebrow">Correspondence</div>
    <h1 class="section-title">Contact</h1>
    <div class="titleblock" style="max-width:520px;margin:24px auto;text-align:left;">
      <div class="tb-main">
        <div class="tb-name">HARVEY DEASON</div>
        <div class="tb-sub">ENGINEER &amp; ESSAYIST</div>
        <p style="margin:12px 0 0;font-size:15px;">
          <a class="gilt-link" href="mailto:deason.harvey11@gmail.com">deason.harvey11@gmail.com</a><br>
          <a class="gilt-link" href="https://harveydeason.wordpress.com/">harveydeason.wordpress.com</a>
        </p>
      </div>
      <div class="tb-logo"><img class="seal seal-sm" src="/assets/img/seal.svg" alt=""></div>
    </div>
  </main>
  <footer id="site-footer"></footer>
  <script type="module">
    import { mountLayout } from '/assets/js/layout.js';
    mountLayout('contact');
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify in preview**

Open `/contact/`. Expected: title-block card with email + WordPress link, seal, "Contact" nav active. Confirm the email address with Harvey before shipping.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: contact page styled as title block"
```

---

## Task 11: Motion & polish (motion.js)

**Files:**
- Create: `assets/js/motion.js`
- Modify: each page's module script to `import { initMotion } from '/assets/js/motion.js'` and call `initMotion()`.

**Interfaces:**
- Produces: `initMotion(): void` — activates `[data-anim="reveal"]` (scroll fade-in), `[data-anim="tilt"]` (cursor tilt on cards), and `[data-count]` (count-up). No-ops under `prefers-reduced-motion`.

- [ ] **Step 1: Implement `assets/js/motion.js`**

```js
export function initMotion(){
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce) return;

  // scroll reveals
  const reveals = document.querySelectorAll('[data-anim="reveal"]');
  reveals.forEach(el=>{ el.style.opacity=0; el.style.transform='translateY(20px)'; el.style.transition='opacity .6s ease, transform .6s ease'; });
  const io = new IntersectionObserver(es=>es.forEach(e=>{ if(e.isIntersecting){ e.target.style.opacity=1; e.target.style.transform='none'; io.unobserve(e.target);} }),{threshold:.15});
  reveals.forEach(el=>io.observe(el));

  // card tilt (delegated; cards may be injected after load)
  document.addEventListener('mousemove', e=>{
    const card = e.target.closest && e.target.closest('[data-anim="tilt"]');
    document.querySelectorAll('[data-anim="tilt"]').forEach(c=>{ if(c!==card) c.style.transform='none'; });
    if(card){ const r=card.getBoundingClientRect(); const px=(e.clientX-r.left)/r.width-.5, py=(e.clientY-r.top)/r.height-.5;
      card.style.transform=`perspective(600px) rotateY(${px*6}deg) rotateX(${-py*6}deg) translateY(-2px)`; }
  });
  document.addEventListener('mouseleave', ()=>document.querySelectorAll('[data-anim="tilt"]').forEach(c=>c.style.transform='none'), true);

  // count-up
  document.querySelectorAll('[data-count]').forEach(el=>{
    const to=+el.dataset.count; const cio=new IntersectionObserver(x=>x.forEach(v=>{ if(v.isIntersecting){ const st=performance.now(); (function tick(t){const p=Math.min((t-st)/1200,1); el.textContent=Math.round(p*to); if(p<1)requestAnimationFrame(tick);})(st); cio.unobserve(el);} }),{threshold:.6}); cio.observe(el);
  });
}
```

- [ ] **Step 2: Call `initMotion()` from every page module** (add the import + call to `index.html`, `tools/index.html`, `writing/index.html`, `writing/post.html`, `about/index.html`, `contact/index.html`).

- [ ] **Step 3: Verify in preview**

Reload `/` and `/tools/`. Expected: sections fade/slide in on scroll; hovering tool/post cards tilts them; with OS "reduce motion" on (preview_resize supports colorScheme; for reduced-motion, verify the guard by temporary matchMedia check), no motion. No console errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: tasteful motion — reveals, card tilt, counters (reduced-motion safe)"
```

---

## Task 12: Responsive, accessibility & mobile gear-train pass

**Files:**
- Modify: `assets/css/site.css`, `assets/js/gear-train.js` (mobile density), page `<main>` landmarks.

- [ ] **Step 1: Add responsive + a11y CSS**

```css
:focus-visible{outline:2px solid var(--green); outline-offset:2px;}
img{max-width:100%;}
@media (max-width:720px){
  .nav{gap:16px; font-size:11px; flex-wrap:wrap; justify-content:flex-end;}
  .hero-frame{padding:22px;}
  .hero-cta{flex-direction:column; gap:12px;}
  .cards-grid{grid-template-columns:1fr;}
}
```

- [ ] **Step 2: Reduce gear-train cost on small screens** — in `initGearTrain`, after computing `dpr`, add:

```js
  const small = Math.min(window.innerWidth, window.innerHeight) < 640;
  const density = opts.density || (small ? 2 : 3);
```
(and use this `density` in the patch loop — replace the earlier `const density = opts.density || 3;`).

- [ ] **Step 3: Verify accessibility & responsive in preview**

- Resize to mobile (preview_resize mobile): hero stacks, nav wraps, cards single-column, gear train lighter but present.
- Keyboard: Tab through header nav, hero CTAs, cards — visible focus ring, logical order.
- Confirm each page has one `<h1>`, `<main>` landmark, and images have `alt`.
Expected: all pass; no console errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: responsive layout, focus states, lighter mobile gear-train"
```

---

## Task 13: Deploy to GitHub Pages

**Files:**
- Create: `CNAME` only if a custom domain is used (skip for now).

- [ ] **Step 1: Create the GitHub repo and push**

```bash
gh repo create harveydeason-site --public --source=. --remote=origin --push
```
(If Harvey wants the root domain `harveydeason.github.io`, name the repo `harveydeason.github.io` instead.)

- [ ] **Step 2: Enable Pages**

```bash
gh api -X POST repos/:owner/harveydeason-site/pages -f source.branch=main -f source.path=/ || true
```
Or via repo Settings → Pages → Source: `main` / root. Confirm the published URL.

- [ ] **Step 3: Verify the live site**

Visit the Pages URL. Expected: Home hero + gear train, Tools cabinet + all 6 tools open and function, Writing pulls live posts and renders a post, About, Contact — all working over HTTPS. Check the browser console on the live site for errors (especially the WordPress fetch under HTTPS and the `.nojekyll` serving of `/assets`).

- [ ] **Step 4: Final commit / tag**

```bash
git add -A
git commit -m "docs: deployment notes" --allow-empty
git tag v0.1.0
```

---

## Self-Review (completed by planner)

**Spec coverage:** Identity/aesthetic → Task 1; header/footer → 2; gear train → 3; Home → 4,7; Tools cabinet + 6 tools → 5,6; Writing (API + full in-site render + fallback + sanitise) → 8; About → 9; Contact → 10; motion set → 11; responsive/a11y/reduced-motion/mobile gear → 12; GitHub Pages deploy → 13. Manifest-driven "add a tool in one line" → 5. All v1 sections covered; Projects/dark-mode correctly excluded (fast-follows).

**Placeholder scan:** No "TBD/TODO/handle edge cases" left in steps; all code blocks are concrete. The About-copy note explicitly marks shippable prose to be personalised (not a code placeholder). Tool source paths use `<highest>` for the latest download revision — an explicit instruction, not a gap.

**Type consistency:** `mountLayout`, `renderHeader/renderFooter` (Task 2) used consistently everywhere. `loadTools/mountTools/renderToolCard` (Task 5) consistent in Tasks 5,7. `fetchPosts/fetchPostBySlug/mountPosts/mountSinglePost/renderPostCard/normalizePost/sanitizeHtml` (Task 8) consistent in Tasks 7,8. `initGearTrain(canvas,opts)` consistent Tasks 3,4,12. `Post` and `Tool` shapes stable across tasks.
