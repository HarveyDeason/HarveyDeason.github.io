const KEY = 'hd-mode';

export function resolveMode(stored, systemDark) {
  if (stored === 'dark' || stored === 'light') return stored;
  return systemDark ? 'dark' : 'light';
}

export function applyMode(mode) {
  document.documentElement.dataset.mode = mode;
}

export function currentMode() {
  return document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light';
}

export function toggleMode() {
  const next = currentMode() === 'dark' ? 'light' : 'dark';
  applyMode(next);
  try { localStorage.setItem(KEY, next); } catch {}
  return next;
}

export function initMode() {
  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch {}
  applyMode(resolveMode(stored, matchMedia('(prefers-color-scheme: dark)').matches));
}
