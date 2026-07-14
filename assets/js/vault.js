// Browser-side unlock flow for gated instrument loader pages.
//
// Mirrors the exact WebCrypto parameters used in scripts/vault-lib.mjs so a
// workshop code entered here derives the identical key that locked the
// tool. No I/O helper here ever receives or logs the passphrase itself —
// only derived key bits (base64) are cached, in sessionStorage, so every
// other locked tool in the same tab unlocks silently once one code has
// been verified.

const PBKDF2_ITERATIONS = 600000;
const KEY_LENGTH_BITS = 256;
const SESSION_KEY = 'hd-vault-key';
const MANIFEST_URL = '/tools/vault-manifest.json';
const VERIFIER_PLAINTEXT = 'hd-vault-ok';

function toBase64(bytes) {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase, saltB64, subtle) {
  const salt = fromBase64(saltB64);
  const baseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    baseKey,
    KEY_LENGTH_BITS,
  );
  return toBase64(new Uint8Array(bits));
}

async function importAesKey(keyB64, subtle) {
  return subtle.importKey('raw', fromBase64(keyB64), 'AES-GCM', false, ['decrypt']);
}

async function decryptText({ iv, ct }, keyB64, subtle) {
  const key = await importAesKey(keyB64, subtle);
  const ptBuf = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(ct));
  return new TextDecoder().decode(ptBuf);
}

async function checkKey(keyB64, manifest, subtle) {
  try {
    const plaintext = await decryptText(manifest.verifier, keyB64, subtle);
    return plaintext === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

function readPayload() {
  const el = document.getElementById('vault-payload');
  if (!el) throw new Error('vault: missing payload script tag');
  return JSON.parse(el.textContent);
}

/** Replaces the whole document with the decrypted tool's own HTML. */
function openTool(html) {
  document.open();
  document.write(html);
  document.close();
}

function triggerShake(card) {
  card.classList.remove('shake');
  // eslint-disable-next-line no-void -- force reflow so the animation can re-trigger on repeated failures
  void card.offsetWidth;
  card.classList.add('shake');
}

async function unlockWithKey(keyB64, payload, subtle) {
  const plaintext = await decryptText(payload, keyB64, subtle);
  openTool(plaintext);
}

async function init() {
  const card = document.getElementById('vault-card');
  const form = document.getElementById('vault-form');
  const input = document.getElementById('vault-input');
  const errorEl = document.getElementById('vault-error');
  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

  const subtle = window.crypto && window.crypto.subtle;
  if (!subtle) {
    if (errorEl) errorEl.textContent = 'This browser cannot run the vault (WebCrypto unavailable).';
    if (input) input.disabled = true;
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  let payload;
  try {
    payload = readPayload();
  } catch {
    // Missing or malformed payload block: the tool can never be decrypted
    // from this page, so surface it rather than leaving a dead form.
    if (errorEl) errorEl.textContent = 'This instrument’s locked payload is missing or corrupt.';
    if (input) input.disabled = true;
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  // Fast path: a key cached from unlocking another tool this session.
  const cachedKeyB64 = sessionStorage.getItem(SESSION_KEY);
  if (cachedKeyB64) {
    try {
      await unlockWithKey(cachedKeyB64, payload, subtle);
      return;
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }

  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const passphrase = input.value;
    if (!passphrase) return;

    if (submitBtn) submitBtn.disabled = true;
    if (errorEl) errorEl.textContent = '';

    try {
      const manifestRes = await fetch(MANIFEST_URL);
      if (!manifestRes.ok) throw new Error('manifest unavailable');
      const manifest = await manifestRes.json();

      const keyB64 = await deriveKey(passphrase, manifest.salt, subtle);
      const ok = await checkKey(keyB64, manifest, subtle);
      if (!ok) {
        if (errorEl) errorEl.textContent = 'Wrong code. Try again.';
        if (card) triggerShake(card);
        input.value = '';
        input.focus();
        return;
      }

      sessionStorage.setItem(SESSION_KEY, keyB64);
      await unlockWithKey(keyB64, payload, subtle);
    } catch {
      if (errorEl) errorEl.textContent = 'Something went wrong opening this instrument.';
      if (card) triggerShake(card);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

init().catch(() => {
  // Last-resort guard: never leave a silently dead form if init itself fails.
  const errorEl = document.getElementById('vault-error');
  if (errorEl) errorEl.textContent = 'Something went wrong opening this instrument.';
});
