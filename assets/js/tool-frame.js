(function(){
  const SUN = '<path d="M12 3v1.5M12 19.5V21M4.2 4.2l1.1 1.1M18.7 18.7l1.1 1.1M3 12h1.5M19.5 12H21M4.2 19.8l1.1-1.1M18.7 5.3l1.1-1.1"/><circle cx="12" cy="12" r="4"/>';
  const MOON = '<path d="M20 13A8 8 0 1 1 11 4a6.5 6.5 0 0 0 9 9z"/>';

  const bar = document.createElement('div');
  bar.id = 'hd-toolbar';
  bar.className = 'nav';
  // sit above tool-page fixed/sticky chrome; inline padding neutralises any
  // tool page that redefines .container
  bar.style.zIndex = '99999';
  bar.innerHTML =
    '<div class="container nav-row" style="max-width:1080px;padding:0 24px;">'
    + '<a href="/tools/" class="btn btn-ghost">&larr; Instruments</a>'
    + '<button class="lamp" id="hd-lamp" aria-label="Toggle evening mode" aria-pressed="false">'
    + '<svg viewBox="0 0 24 24" id="hd-lamp-ico">' + SUN + '</svg>'
    + '</button>'
    + '</div>';
  document.body.insertBefore(bar, document.body.firstChild);

  import('/assets/js/mode.js').then(function(mode){
    mode.initMode();
    const lamp = document.getElementById('hd-lamp');
    const ico = document.getElementById('hd-lamp-ico');
    if(!lamp) return;
    const sync = function(){
      const dark = mode.currentMode() === 'dark';
      lamp.setAttribute('aria-pressed', String(dark));
      if(ico) ico.innerHTML = dark ? MOON : SUN;
    };
    sync();
    lamp.addEventListener('click', function(){ mode.toggleMode(); sync(); });
  });
})();
