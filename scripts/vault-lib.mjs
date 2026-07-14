// Pure crypto helpers for the workshop-code vault.
//
// Uses node:crypto's webcrypto implementation so the exact same algorithm
// identifiers and parameters used here also run unmodified in the browser
// (see assets/js for the browser-side unlock counterpart in Task P2-2).
//
// No I/O, no prompts — everything here is a pure function over
// Uint8Array/base64-string inputs and outputs.

import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;

const PBKDF2_ITERATIONS = 600000;
const KEY_LENGTH_BITS = 256;
const IV_LENGTH_BYTES = 12;

/** Verifier plaintext stored (encrypted) in the manifest to check a candidate key. */
const VERIFIER_PLAINTEXT = 'hd-vault-ok';

function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * Derives a 256-bit AES-GCM key from a passphrase and a base64-encoded salt
 * using PBKDF2-SHA256. Returns the raw key bits as a base64 string.
 */
export async function deriveKey(passphrase, saltB64) {
  const salt = fromBase64(saltB64);
  const baseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: PBKDF2_ITERATIONS,
    },
    baseKey,
    KEY_LENGTH_BITS,
  );
  return toBase64(new Uint8Array(bits));
}

async function importAesKey(keyB64) {
  return subtle.importKey('raw', fromBase64(keyB64), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Encrypts plaintext with AES-256-GCM under a fresh random 12-byte IV.
 * Returns { iv, ct } as base64 strings.
 */
export async function encryptText(plaintext, keyB64) {
  const key = await importAesKey(keyB64);
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const ctBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ctBuf)) };
}

/**
 * Decrypts { iv, ct } with AES-256-GCM. Throws if the key is wrong or the
 * ciphertext has been tampered with (GCM authentication failure).
 */
export async function decryptText({ iv, ct }, keyB64) {
  const key = await importAesKey(keyB64);
  const ptBuf = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    key,
    fromBase64(ct),
  );
  return new TextDecoder().decode(ptBuf);
}

/**
 * Builds a manifest for a fresh passphrase: a random 16-byte salt and an
 * encrypted verifier that later lets checkKey() confirm a candidate key
 * without ever storing the passphrase itself.
 */
export async function makeManifest(passphrase) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const saltB64 = toBase64(salt);
  const keyB64 = await deriveKey(passphrase, saltB64);
  const verifier = await encryptText(VERIFIER_PLAINTEXT, keyB64);
  return { salt: saltB64, verifier };
}

/**
 * Checks whether a derived key correctly decrypts the manifest's verifier.
 * Returns true/false rather than throwing, so callers can loop or prompt.
 */
export async function checkKey(keyB64, manifest) {
  try {
    const plaintext = await decryptText(manifest.verifier, keyB64);
    return plaintext === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}
