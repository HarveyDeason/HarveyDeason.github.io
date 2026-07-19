const KEY = 'hd-mode';

function currentMode() {
  return document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light';
}

function applyMode(mode) {
  document.documentElement.dataset.mode = mode;
}

function toggleMode() {
  const next = currentMode() === 'dark' ? 'light' : 'dark';
  applyMode(next);
  try { localStorage.setItem(KEY, next); } catch {}
  return next;
}

function injectChrome() {
  if (document.querySelector('.toolbar-bar')) return;

  const title = document.body.dataset.toolName
    || document.title.split(' — ')[0];

  const bar = document.createElement('div');
  bar.className = 'toolbar-bar';
  bar.innerHTML = `
    <a class="wordmark" href="/tools/">Harvey Deason</a>
    <span class="tool-title"></span>
    <button type="button" class="lamp" aria-pressed="${currentMode() === 'dark'}" aria-label="Toggle dark mode">
      <svg viewBox="0 0 24 24"><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z"/></svg>
    </button>
  `;
  bar.querySelector('.tool-title').textContent = title;

  const lamp = bar.querySelector('.lamp');
  lamp.addEventListener('click', () => {
    const next = toggleMode();
    lamp.setAttribute('aria-pressed', String(next === 'dark'));
  });

  document.body.insertBefore(bar, document.body.firstChild);
}

document.addEventListener('DOMContentLoaded', injectChrome);
