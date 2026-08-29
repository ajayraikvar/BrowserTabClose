(() => {
  const PUBLIC_KEY = "edgeclose-backup-public-key";
  const PRIVATE_WRAP = "edgeclose-backup-private-wrap";
  const AUTH_HASH = "edgeclose-settings-password-hash";
  const AUTH_SALT = "edgeclose-settings-password-salt";
  const AUTH_ITERATIONS = "edgeclose-settings-password-iterations";
  const ITERATIONS = 310000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let setupPassword = "";
  let oldPassword = "";
  let newPassword = "";

  const b64 = (bytes) => { let text = ""; bytes.forEach((byte) => { text += String.fromCharCode(byte); }); return btoa(text); };
  const fromB64 = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  const dataUrl = (value) => `data:application/octet-stream;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(value))))}`;

  async function derive(password, salt) {
    const raw = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encrypt(value, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(value)));
    return { iv: b64(iv), ciphertext: b64(new Uint8Array(cipher)) };
  }
  async function decrypt(record, key) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(record.iv) }, key, fromB64(record.ciphertext));
    return JSON.parse(decoder.decode(plain));
  }
  async function saveRecovery(privateJwk, publicJwk, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const encrypted = await encrypt({ schemaVersion: 1, version: "1.6.0", publicKey: publicJwk, privateKey: privateJwk }, await derive(password, salt));
    await chrome.downloads.download({ url: dataUrl({ schemaVersion: 1, type: "edgeclose-recovery-key", kdfIterations: ITERATIONS, salt: b64(salt), ...encrypted }), filename: "EdgeClose/recovery-key.enc", saveAs: false, conflictAction: "overwrite" });
    const wrapSalt = crypto.getRandomValues(new Uint8Array(16));
    const wrapped = await encrypt({ privateKey: privateJwk }, await derive(password, wrapSalt));
    await chrome.storage.local.set({ [PRIVATE_WRAP]: { kdfIterations: ITERATIONS, salt: b64(wrapSalt), ...wrapped } });
  }
  async function createRecovery(password) {
    const pair = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    await chrome.storage.local.set({ [PUBLIC_KEY]: publicJwk });
    await saveRecovery(privateJwk, publicJwk, password);
    await chrome.runtime.sendMessage({ type: "edgeclose-backup-now" }).catch(() => {});
  }
  async function rewrapRecovery(oldPw, newPw) {
    const stored = await chrome.storage.local.get([PUBLIC_KEY, PRIVATE_WRAP]);
    if (!stored[PUBLIC_KEY] || !stored[PRIVATE_WRAP]) { await createRecovery(newPw); return; }
    const privateKey = await decrypt(stored[PRIVATE_WRAP], await derive(oldPw, fromB64(stored[PRIVATE_WRAP].salt)));
    await saveRecovery(privateKey.privateKey, stored[PUBLIC_KEY], newPw);
    await chrome.runtime.sendMessage({ type: "edgeclose-backup-now" }).catch(() => {});
  }
  function schedule(fn, delay) { window.setTimeout(() => fn().catch(() => {}), delay); }

  const setup = document.querySelector("#setup-form");
  setup?.addEventListener("submit", () => { setupPassword = document.querySelector("#setup-password")?.value || ""; schedule(async () => { const stored = await chrome.storage.local.get([PUBLIC_KEY, AUTH_HASH, AUTH_SALT]); if (setupPassword && !stored[PUBLIC_KEY] && stored[AUTH_HASH] && stored[AUTH_SALT]) await createRecovery(setupPassword); setupPassword = ""; }, 1200); });

  const change = document.querySelector("#change-password-form");
  change?.addEventListener("submit", () => { oldPassword = document.querySelector("#current-password")?.value || ""; newPassword = document.querySelector("#new-password")?.value || ""; schedule(async () => { if (oldPassword && newPassword) await rewrapRecovery(oldPassword, newPassword); oldPassword = ""; newPassword = ""; }, 1800); });
})();
