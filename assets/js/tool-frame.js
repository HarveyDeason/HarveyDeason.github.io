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
