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
