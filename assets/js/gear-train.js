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

// ---- interactive render (browser only) ----
export function initGearTrain(canvas, opts = {}) {
  const cfg = opts.config || GEAR_CONFIG;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const small = Math.min(window.innerWidth, window.innerHeight) < 640;
  const density = opts.density || (small ? 2 : 3);
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

  let phi=0, vel=0, drag=false, lastX=0, mvx=0, mvy=0, tilt=0.62, viewY=0, running=true;
  canvas.addEventListener('pointerdown',e=>{drag=true;lastX=e.clientX;canvas.setPointerCapture(e.pointerId);wake();});
  canvas.addEventListener('pointermove',e=>{ if(drag){vel+=(e.clientX-lastX)*0.0016;lastX=e.clientX;wake();} const r=canvas.getBoundingClientRect(); mvx=(e.clientX-r.left)/r.width-.5; mvy=(e.clientY-r.top)/r.height-.5; });
  canvas.addEventListener('pointerup',()=>drag=false);
  canvas.addEventListener('pointercancel',()=>drag=false);

  const range=15.5;
  function wake(){ if(!running){ running = true; requestAnimationFrame(frame); } }
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
    const idle = reduce && !drag && Math.abs(vel) < 1e-4;
    if (idle) { running = false; return; }   // settled still-frame under reduced motion: pause
    requestAnimationFrame(frame);
  }
  frame();
}
