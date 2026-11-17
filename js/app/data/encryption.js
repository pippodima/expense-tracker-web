/* Password-encrypted backups (Web Crypto). */
'use strict';

/* ======================= Encrypted backups =======================
   AES-GCM with a PBKDF2-derived key (WebCrypto, no dependencies). The
   password never leaves the device and is never stored — lose it and the
   file is unrecoverable, which the UI says plainly before exporting. */

const ENC_MAGIC = 'expense-tracker-encrypted';
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptPayload(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(text));
  return JSON.stringify({
    app: ENC_MAGIC, v: 1, kdf: 'PBKDF2-SHA256', iterations: 250000,
    salt: b64(salt), iv: b64(iv), data: b64(ct)
  }, null, 2);
}

async function decryptPayload(obj, password) {
  const key = await deriveKey(password, unb64(obj.salt));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(obj.iv) }, key, unb64(obj.data));
  return new TextDecoder().decode(plain);
}

function askPassword(title, message, confirmLabel, needsTwice) {
  return new Promise((resolve) => {
    openSheet(title, (body, api) => {
      const p1 = el('input', { type: 'password', placeholder: 'Password',
        autocomplete: 'new-password' });
      const p2 = el('input', { type: 'password', placeholder: 'Repeat password',
        autocomplete: 'new-password' });
      let done = false;
      body.append(
        el('p', { class: 'muted', style: 'line-height:1.5;margin-bottom:14px', text: message }),
        el('div', { class: 'field' }, [el('label', { text: 'Password' }), p1]),
        needsTwice ? el('div', { class: 'field' }, [el('label', { text: 'Repeat' }), p2]) : null,
        el('button', { class: 'btn block primary', text: confirmLabel, onclick: () => {
          if (!p1.value) return toast('Enter a password');
          if (needsTwice && p1.value !== p2.value) return toast('Passwords don’t match');
          if (needsTwice && p1.value.length < 6) return toast('Use at least 6 characters');
          done = true; const v = p1.value; api.close(); resolve(v);
        } })
      );
      const origClose = api.close;
      api.close = () => { origClose(); if (!done) resolve(null); };
      setTimeout(() => p1.focus(), 320);
    });
  });
}

async function exportEncrypted() {
  const pw = await askPassword('Encrypted backup',
    'The file is scrambled with this password. It is never stored anywhere — if you forget ' +
    'it, the backup cannot be opened by anyone, including you.', 'Encrypt & export', true);
  if (!pw) return;
  try {
    const enc = await encryptPayload(JSON.stringify(buildBackupPayload()), pw);
    const how = await U.saveFile(exportName('expense-tracker-encrypted', 'json'),
      enc, 'application/json');
    if (how === 'cancelled') return;
    await DB.setMeta('lastBackup', Date.now());
    await DB.setMeta('changesSinceBackup', 0);
    await DB.setMeta('backupSnoozeUntil', 0);
    toast('Encrypted backup exported ✓');
    render();
  } catch (e) {
    console.warn(e); toast('Encryption failed');
  }
}
