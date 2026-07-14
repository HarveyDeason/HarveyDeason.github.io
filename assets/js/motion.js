// Motion polish: staggered reveals, count-up stats, cursor spotlight.
// Reduced motion: content is shown immediately (never hidden), stats snap to
// their final value, and the spotlight is not wired up at all.

export function initMotion(){
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  countUp(reduce);
  if(reduce) return;               // nothing below runs under reduced motion
  setupReveals();
  setupSpotlight();
}

// ——— count-up ———————————————————————————————————————————————
// Preserves leading-zero formatting by padding to the original text length,
// so "06" ticks up and lands on "06" (not "6").
function countUp(reduce){
  document.querySelectorAll('[data-count]').forEach(el=>{
    const to  = +el.dataset.count;
    const pad = el.textContent.trim().length;          // captured before we touch it
    const fmt = v => String(v).padStart(pad, '0');

    if(reduce){ el.textContent = fmt(to); return; }    // snap to final value

    const io = new IntersectionObserver(es=>es.forEach(e=>{
      if(!e.isIntersecting) return;
      const start = performance.now();
      (function tick(t){
        const p = Math.min((t - start) / 1200, 1);
        el.textContent = fmt(Math.round(p * to));
        if(p < 1) requestAnimationFrame(tick);
      })(start);
      io.unobserve(el);
    }), { threshold:.6 });
    io.observe(el);
  });
}

// ——— staggered reveals ——————————————————————————————————————
// Sections marked [data-anim="reveal"] rise 12px over 0.5s the first time they
// scroll into view. Direct children of a .bento inside them rise
// individually with a 60ms incremental transition-delay for a cascade.
function setupReveals(){
  const hide = (el, delay = 0) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(12px)';
    el.style.transition = 'opacity .5s ease, transform .5s ease';
    el.style.transitionDelay = delay ? delay + 'ms' : '';
  };
  const show = el => { el.style.opacity = '1'; el.style.transform = 'none'; };

  // Reveal a grid's direct children with a staggered delay. Robust to async
  // injection (skeleton cells → real cells replaced via innerHTML): a
  // MutationObserver re-applies the effect whenever the children change.
  const revealGrid = grid => {
    const applyHidden = () => Array.from(grid.children).forEach((c,i)=>hide(c, i*60));
    const applyShow   = () => requestAnimationFrame(()=>Array.from(grid.children).forEach(show));

    let seen = false;
    applyHidden();

    const io = new IntersectionObserver(es=>es.forEach(e=>{
      if(!e.isIntersecting) return;
      seen = true;
      applyShow();
      io.unobserve(grid);
    }), { threshold:.15 });
    io.observe(grid);

    new MutationObserver(()=>{ applyHidden(); if(seen) applyShow(); })
      .observe(grid, { childList:true });
  };

  const sections = document.querySelectorAll('[data-anim="reveal"]');
  const io = new IntersectionObserver(es=>es.forEach(e=>{
    if(!e.isIntersecting) return;
    show(e.target);
    io.unobserve(e.target);
  }), { threshold:.15 });

  sections.forEach(sec=>{
    hide(sec);
    io.observe(sec);
    sec.querySelectorAll('.bento').forEach(revealGrid);
  });
}

// ——— spotlight ——————————————————————————————————————————————
// Delegated pointermove sets --mx/--my on the hovered .cell; the CSS ::after
// radial-gradient (gated @media (pointer:fine)) follows the cursor. Delegation
// covers cells injected after load. Not called under reduced motion.
function setupSpotlight(){
  document.addEventListener('pointermove', e=>{
    const cell = e.target.closest && e.target.closest('.cell');
    if(!cell) return;
    const r = cell.getBoundingClientRect();
    cell.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    cell.style.setProperty('--my', (e.clientY - r.top)  + 'px');
  });
}
