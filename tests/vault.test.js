import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveKey,
  encryptText,
  decryptText,
  makeManifest,
  checkKey,
} from '../scripts/vault-lib.mjs';

// Throwaway passphrases for testing only — never real workshop codes.
const TEST_PASSPHRASE = 'test-only-throwaway-pass-1';
const OTHER_PASSPHRASE = 'test-only-throwaway-pass-2';

test('deriveKey + encryptText/decryptText round-trips plaintext', async () => {
  const saltB64 = Buffer.from('0123456789abcdef').toString('base64');
  const keyB64 = await deriveKey(TEST_PASSPHRASE, saltB64);
  const plaintext = 'The quick brown fox jumps over the lazy dog.';

  const { iv, ct } = await encryptText(plaintext, keyB64);
  const decrypted = await decryptText({ iv, ct }, keyB64);

  assert.equal(decrypted, plaintext);
});

test('decryptText throws when given the wrong key', async () => {
  const saltB64 = Buffer.from('0123456789abcdef').toString('base64');
  const rightKey = await deriveKey(TEST_PASSPHRASE, saltB64);
  const wrongKey = await deriveKey(OTHER_PASSPHRASE, saltB64);

  const { iv, ct } = await encryptText('secret payload', rightKey);

  await assert.rejects(() => decryptText({ iv, ct }, wrongKey));
});

test('decryptText throws when ciphertext has been tampered with', async () => {
  const saltB64 = Buffer.from('0123456789abcdef').toString('base64');
  const keyB64 = await deriveKey(TEST_PASSPHRASE, saltB64);

  const { iv, ct } = await encryptText('secret payload', keyB64);

  // Flip a byte in the ciphertext.
  const ctBuf = Buffer.from(ct, 'base64');
  ctBuf[0] ^= 0xff;
  const tamperedCt = ctBuf.toString('base64');

  await assert.rejects(() => decryptText({ iv, ct: tamperedCt }, keyB64));
});

test('two encryptions of the same plaintext produce different IV and ciphertext', async () => {
  const saltB64 = Buffer.from('0123456789abcdef').toString('base64');
  const keyB64 = await deriveKey(TEST_PASSPHRASE, saltB64);

  const a = await encryptText('same plaintext every time', keyB64);
  const b = await encryptText('same plaintext every time', keyB64);

  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('makeManifest produces a salt and verifier, and checkKey accepts the correct passphrase', async () => {
  const manifest = await makeManifest(TEST_PASSPHRASE);

  assert.ok(typeof manifest.salt === 'string' && manifest.salt.length > 0);
  assert.ok(typeof manifest.verifier.iv === 'string');
  assert.ok(typeof manifest.verifier.ct === 'string');

  const keyB64 = await deriveKey(TEST_PASSPHRASE, manifest.salt);
  assert.equal(await checkKey(keyB64, manifest), true);
});

test('checkKey rejects an incorrect passphrase', async () => {
  const manifest = await makeManifest(TEST_PASSPHRASE);

  const wrongKeyB64 = await deriveKey(OTHER_PASSPHRASE, manifest.salt);
  assert.equal(await checkKey(wrongKeyB64, manifest), false);
});

test('deriveKey produces a 32-byte key', async () => {
  const saltB64 = Buffer.from('0123456789abcdef').toString('base64');
  const keyB64 = await deriveKey(TEST_PASSPHRASE, saltB64);
  assert.equal(Buffer.from(keyB64, 'base64').length, 32);
});

test('encryptText produces a 12-byte IV', async () => {
  const saltB64 = Buffer.from('0123456789abcdef').toString('base64');
  const keyB64 = await deriveKey(TEST_PASSPHRASE, saltB64);
  const { iv } = await encryptText('x', keyB64);
  assert.equal(Buffer.from(iv, 'base64').length, 12);
});

// ── Loader-page self-containment ─────────────────────────────────────────
// Every republish generates a NEW random salt. The loader page used to carry
// only the ciphertext and fetch the salt separately from vault-manifest.json,
// so a browser holding a CACHED older manifest would derive an old key, pass
// the verifier check (the old manifest is internally consistent), then fail to
// decrypt the fresh payload — surfacing as "Something went wrong opening this
// instrument" rather than "Wrong code". Embedding the salt and verifier in the
// same page as the ciphertext makes that mismatch structurally impossible.
import { renderLoaderPage } from '../scripts/lock-tools.mjs';

test('loader page embeds the manifest so payload and salt cannot come from different builds', async () => {
  const manifest = await makeManifest('correct horse');
  const keyB64 = await deriveKey('correct horse', manifest.salt);
  const payload = await encryptText('<h1>tool</h1>', keyB64);

  const html = renderLoaderPage('demo', payload, manifest);
  const block = /<script type="application\/json" id="vault-manifest">(.+?)<\/script>/s.exec(html);
  assert.ok(block, 'loader page carries an embedded manifest block');

  const embedded = JSON.parse(block[1]);
  assert.equal(embedded.salt, manifest.salt);
  assert.deepEqual(embedded.verifier, manifest.verifier);
});

test('the embedded manifest actually unlocks the payload on the same page', async () => {
  const manifest = await makeManifest('correct horse');
  const keyB64 = await deriveKey('correct horse', manifest.salt);
  const payload = await encryptText('<h1>tool</h1>', keyB64);
  const html = renderLoaderPage('demo', payload, manifest);

  const m = JSON.parse(/<script type="application\/json" id="vault-manifest">(.+?)<\/script>/s.exec(html)[1]);
  const p = JSON.parse(/<script type="application\/json" id="vault-payload">(.+?)<\/script>/s.exec(html)[1]);

  const derived = await deriveKey('correct horse', m.salt);
  assert.equal(await checkKey(derived, m), true);
  assert.equal(await decryptText(p, derived), '<h1>tool</h1>');
});

test('the loader page never contains the plaintext it is protecting', async () => {
  const manifest = await makeManifest('correct horse');
  const keyB64 = await deriveKey('correct horse', manifest.salt);
  const payload = await encryptText('SECRET-MARKER-TEXT', keyB64);
  const html = renderLoaderPage('demo', payload, manifest);
  assert.equal(html.includes('SECRET-MARKER-TEXT'), false);
});
