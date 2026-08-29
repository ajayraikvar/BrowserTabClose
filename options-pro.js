(() => {
  const KEYS = {
    publicKey: "edgeclose-backup-public-key",
    privateWrap: "edgeclose-backup-private-wrap",
    authHash: "edgeclose-settings-password-hash",
    authSalt: "edgeclose-settings-password-salt",
    authIterations: "edgeclose-settings-password-iterations"
  };
  const ITERATIONS = 310000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const $ = (selector) => document.querySelector(selector);

  const toB64 = (bytes) => {
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  };
  const fromB64 = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  const jsonDataUrl = (value) => `data:application/octet-stream;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(value))))}`;

  async function deriveKey(password, salt, usages = ["encrypt", "decrypt"]) {
    const raw = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, raw, { name: "AES-GCM", length: 256 }, false, usages);
  }
  async function encrypt(value, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(value)));
    return { iv: toB64(iv), ciphertext: toB64(new Uint8Array(ciphertext)) };
  }
  async function decrypt(record, key) {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(record.iv) }, key, fromB64(record.ciphertext));
    return JSON.parse(decoder.decode(plaintext));
  }
  async function verify(password) {
    const stored = await chrome.storage.local.get([KEYS.authHash, KEYS.authSalt, KEYS.authIterations]);
    if (!stored[KEYS.authHash] || !stored[KEYS.authSalt]) return false;
    const raw = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromB64(stored[KEYS.authSalt]), iterations: Number(stored[KEYS.authIterations]) || ITERATIONS, hash: "SHA-256" }, raw, 256);
    const actual = fromB64(stored[KEYS.authHash]);
    const got = new Uint8Array(bits);
    if (actual.length !== got.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i += 1) diff |= actual[i] ^ got[i];
    return diff === 0;
  }
  async function exportKeyPair(pair) { return { publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey), privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey) }; }
  async function createBackupKeyPair(password) {
    const pair = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
    const keys = await exportKeyPair(pair);
    await chrome.storage.local.set({ [KEYS.publicKey]: keys.publicKey });
    await saveRecovery(keys.privateKey, keys.publicKey, password);
  }
  async function saveRecovery(privateJwk, publicJwk, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    const encrypted = await encrypt({ schemaVersion: 1, version: "1.6.0", publicKey: publicJwk, privateKey: privateJwk }, key);
    const record = { schemaVersion: 1, type: "edgeclose-recovery-key", kdfIterations: ITERATIONS, salt: toB64(salt), ...encrypted };
    await chrome.downloads.download({ url: jsonDataUrl(record), filename: "EdgeClose/recovery-key.enc", saveAs: false, conflictAction: "overwrite" });
    const wrapSalt = crypto.getRandomValues(new Uint8Array(16));
    const localKey = await deriveKey(password, wrapSalt);
    const wrapped = await encrypt({ privateKey: privateJwk }, localKey);
    await chrome.storage.local.set({ [KEYS.privateWrap]: { kdfIterations: ITERATIONS, salt: toB64(wrapSalt), ...wrapped } });
  }
  async function ensureKeys(password) {
    const stored = await chrome.storage.local.get(KEYS.publicKey);
    if (!stored[KEYS.publicKey]) await createBackupKeyPair(password);
  }
  async function refreshRecovery(password) {
    const local = await chrome.storage.local.get([KEYS.publicKey, KEYS.privateWrap]);
    if (!local[KEYS.publicKey] || !local[KEYS.privateWrap]) { await createBackupKeyPair(password); return; }
    const wrapped = await decrypt(local[KEYS.privateWrap], await deriveKey(password, fromB64(local[KEYS.privateWrap].salt)));
    await saveRecovery(wrapped.privateKey, local[KEYS.publicKey], password);
  }

  function injectStyles() {
    if (document.getElementById("edgeclose-v160-style")) return;
    const style = document.createElement("style");
    style.id = "edgeclose-v160-style";
    style.textContent = `
      .ec160-card{margin:0 0 18px;padding:22px;border:1px solid #dbe4e7;border-radius:16px;background:#fff;box-shadow:0 14px 34px rgba(20,47,58,.07)}
      .ec160-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.ec160-kicker{margin:0 0 6px;color:#1f6feb;font-size:.7rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.ec160-head h2{margin:0;font-size:1.12rem}.ec160-copy{margin:7px 0 16px;color:#66767d;font-size:.82rem;line-height:1.5}.ec160-pill{display:inline-flex;padding:7px 10px;border-radius:999px;background:#eaf8f1;color:#16835b;font-size:.7rem;font-weight:850;white-space:nowrap}.ec160-pill.paused{background:#fff6de;color:#a36a00}.ec160-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.ec160-actions button{padding:11px 8px;border:1px solid #dbe4e7;border-radius:10px;background:#f7fafb;color:#172329;font:800 .78rem Inter,sans-serif;cursor:pointer}.ec160-actions button:hover{border-color:#91b5ee;background:#eaf2ff;color:#1757bd}.ec160-actions .wide{grid-column:1/-1;background:#eaf8f1;border-color:#c7e8d8;color:#16835b}.ec160-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ec160-mini{padding:15px;border:1px solid #dbe4e7;border-radius:12px;background:#f7fafb}.ec160-mini strong{display:block;font-size:.82rem}.ec160-mini span{display:block;margin-top:5px;color:#66767d;font-size:.75rem;line-height:1.45}.ec160-mini button{margin-top:10px}.ec160-modal{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(13,25,32,.46)}.ec160-modal[hidden]{display:none}.ec160-dialog{width:min(100%,410px);padding:24px;border:1px solid #dbe4e7;border-radius:16px;background:#fff;box-shadow:0 24px 80px rgba(13,25,32,.25)}.ec160-dialog h2{margin:0 0 7px;font-size:1.15rem}.ec160-dialog p{margin:0 0 15px;color:#66767d;font-size:.8rem;line-height:1.5}.ec160-dialog form{display:grid;gap:10px}.ec160-dialog input{max-width:none}.ec160-dialog-actions{display:flex;justify-content:flex-end;gap:8px}.ec160-status{min-height:18px;margin-top:8px;color:#b23b36;font-size:.76rem;font-weight:700}.ec160-restore{display:grid;gap:10px;margin-top:12px;padding-top:14px;border-top:1px solid #dbe4e7}.ec160-restore label{display:grid;gap:6px;color:#66767d;font-size:.74rem;font-weight:750}.ec160-restore input[type=file]{max-width:none}.ec160-restore button{justify-self:start}.ec160-note{margin:10px 0 0;color:#66767d;font-size:.74rem;line-height:1.4}@media(max-width:700px){.ec160-actions,.ec160-grid{grid-template-columns:1fr}.ec160-actions .wide{grid-column:auto}}
    `;
    document.head.append(style);
  }

  function addControls() {
    if (!$("#protected-content") || $("#ec160-controls")) return;
    injectStyles();
    const root = $("#protected-content");
    const pause = document.createElement("section");
    pause.id = "ec160-controls";
    pause.className = "ec160-card";
    pause.innerHTML = `<div class="ec160-head"><div><p class="ec160-kicker">Protection control</p><h2>Temporary pause</h2><p class="ec160-copy">Pause and resume are available only here. Every action requires a fresh settings-password confirmation.</p></div><span id="ec160-pill" class="ec160-pill">Protection ON</span></div><div class="ec160-actions"><button type="button" data-ec-pause="15">15 minutes</button><button type="button" data-ec-pause="60">1 hour</button><button type="button" data-ec-pause="1440">24 hours</button><button id="ec160-resume" type="button" class="wide">Resume protection</button></div>`;
    root.insertBefore(pause, root.children[1] || root.firstChild);

    const backup = document.createElement("section");
    backup.className = "ec160-card";
    backup.innerHTML = `<div class="ec160-head"><div><p class="ec160-kicker">Persistence</p><h2>Encrypted local backup</h2><p class="ec160-copy">The current configuration and audit history are backed up in encrypted files outside extension storage.</p></div></div><div class="ec160-grid"><div class="ec160-mini"><strong>Configuration + audit</strong><span>Downloads\\EdgeClose\\config-audit.enc</span><button id="ec160-backup" type="button" class="secondary-button">Backup now</button></div><div class="ec160-mini"><strong>Recovery key</strong><span>Password-protected key file used to restore after reinstall.</span><button id="ec160-recovery" type="button" class="secondary-button">Refresh recovery</button></div></div><p class="ec160-note">The files are encrypted. Anyone who can modify the Downloads folder can still delete or replace the backup.</p>`;
    root.insertBefore(backup, root.lastElementChild);

    const restore = document.createElement("section");
    restore.className = "ec160-card";
    restore.innerHTML = `<div class="ec160-head"><div><p class="ec160-kicker">Recovery</p><h2>Restore after reinstall</h2><p class="ec160-copy">Restore your previous rules and audit history using the password and both encrypted files.</p></div></div><div class="ec160-restore"><label>Password<input id="ec160-restore-password" type="password" autocomplete="current-password"></label><label>Recovery key<input id="ec160-restore-key" type="file" accept=".enc,application/json"></label><label>Config + audit backup<input id="ec160-restore-config" type="file" accept=".enc,application/json"></label><button id="ec160-restore-button" type="button" class="secondary-button">Restore encrypted backup</button><p id="ec160-restore-status" class="ec160-status"></p></div>`;
    root.append(restore);

    const modal = document.createElement("div");
    modal.className = "ec160-modal"; modal.hidden = true;
    modal.innerHTML = `<div class="ec160-dialog" role="dialog" aria-modal="true" aria-labelledby="ec160-auth-title"><h2 id="ec160-auth-title">Password required</h2><p id="ec160-auth-copy">Enter your settings password to continue.</p><form id="ec160-auth-form"><input id="ec160-auth-password" type="password" autocomplete="current-password" required><div class="ec160-dialog-actions"><button id="ec160-auth-cancel" type="button" class="text-button">Cancel</button><button type="submit" class="primary-button">Confirm</button></div><p id="ec160-auth-error" class="ec160-status"></p></form></div>`;
    document.body.append(modal);

    const askPassword = (copy, action) => new Promise((resolve) => {
      $("#ec160-auth-copy").textContent = copy;
      $("#ec160-auth-password").value = "";
      $("#ec160-auth-error").textContent = "";
      modal.hidden = false;
      const cancel = () => { modal.hidden = true; cleanup(); resolve(false); };
      const submit = async (event) => { event.preventDefault(); const password = $("#ec160-auth-password").value; if (!(await verify(password))) { $("#ec160-auth-error").textContent = "Incorrect password."; return; } modal.hidden = true; cleanup(); await action(password); resolve(true); };
      const cleanup = () => { $("#ec160-auth-cancel").removeEventListener("click", cancel); $("#ec160-auth-form").removeEventListener("submit", submit); };
      $("#ec160-auth-cancel").addEventListener("click", cancel); $("#ec160-auth-form").addEventListener("submit", submit); $("#ec160-auth-password").focus();
    });

    pause.querySelectorAll("[data-ec-pause]").forEach((button) => button.addEventListener("click", () => askPassword("Enter your settings password to pause protection.", async () => { const result = await chrome.runtime.sendMessage({ type: "edgeclose-pause", minutes: Number(button.dataset.ecPause) }); if (result?.ok) await refresh(); })));
    $("#ec160-resume").addEventListener("click", () => askPassword("Enter your settings password to resume protection.", async () => { await chrome.runtime.sendMessage({ type: "edgeclose-resume" }); await refresh(); }));
    $("#ec160-backup").addEventListener("click", () => askPassword("Enter your settings password to create an encrypted backup.", async (password) => { try { await ensureKeys(password); const result = await chrome.runtime.sendMessage({ type: "edgeclose-backup-now" }); $("#ec160-backup").textContent = result?.ok ? "Backup created" : "Backup unavailable"; setTimeout(() => { $("#ec160-backup").textContent = "Backup now"; }, 2200); } catch { $("#ec160-backup").textContent = "Backup failed"; setTimeout(() => { $("#ec160-backup").textContent = "Backup now"; }, 2200); } }));
    $("#ec160-recovery").addEventListener("click", () => askPassword("Enter your settings password to refresh the recovery key.", async (password) => { try { await refreshRecovery(password); $("#ec160-recovery").textContent = "Recovery refreshed"; } catch { $("#ec160-recovery").textContent = "Recovery failed"; } setTimeout(() => { $("#ec160-recovery").textContent = "Refresh recovery"; }, 2200); }));
    $("#ec160-restore-button").addEventListener("click", restoreBackup);
    refresh();
  }

  async function refresh() {
    const state = await chrome.runtime.sendMessage({ type: "edgeclose-admin-state" }).catch(() => null);
    if (!state) return;
    const pill = $("#ec160-pill");
    if (pill) { pill.textContent = state.paused ? "Protection paused" : "Protection ON"; pill.classList.toggle("paused", !!state.paused); }
    const dash = $("#protection-state"); if (dash) dash.textContent = state.paused ? "Paused" : "ON";
    const detail = $("#pause-state"); if (detail) detail.textContent = state.paused ? "Temporarily paused; resume requires password." : "Pause/resume is controlled here and requires password.";
  }

  async function restoreBackup() {
    const status = $("#ec160-restore-status");
    status.textContent = "";
    const password = $("#ec160-restore-password").value;
    const recoveryFile = $("#ec160-restore-key").files?.[0];
    const configFile = $("#ec160-restore-config").files?.[0];
    if (!password || !recoveryFile || !configFile) { status.textContent = "Select both encrypted files and enter the password."; return; }
    try {
      const recovery = JSON.parse(await recoveryFile.text());
      const recoveryKey = await deriveKey(password, fromB64(recovery.salt));
      const recovered = await decrypt(recovery, recoveryKey);
      const privateKey = await crypto.subtle.importKey("jwk", recovered.privateKey, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
      const config = JSON.parse(await configFile.text());
      const rawAes = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, fromB64(config.wrappedKey));
      const aes = await crypto.subtle.importKey("raw", rawAes, { name: "AES-GCM" }, false, ["decrypt"]);
      const payload = await decrypt(config, aes);
      if (!(await verifyBackup(password, payload.auth))) throw new Error("Wrong password or invalid backup.");
      await chrome.storage.local.set({ sites: Array.isArray(payload.sites) ? payload.sites : [], "edgeclose-audit-log": Array.isArray(payload.audit) ? payload.audit : [], "edgeclose-pause-until": Number(payload.pauseUntil) || 0, [KEYS.authHash]: payload.auth.hash, [KEYS.authSalt]: payload.auth.salt, [KEYS.authIterations]: payload.auth.iterations, [KEYS.publicKey]: recovered.publicKey });
      await refreshRecovery(password);
      status.textContent = "Backup restored. Reloading…";
      setTimeout(() => location.reload(), 700);
    } catch (error) { status.textContent = error?.message || "Could not restore backup."; }
  }
  async function verifyBackup(password, auth) {
    if (!auth?.hash || !auth?.salt) return false;
    const raw = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromB64(auth.salt), iterations: Number(auth.iterations) || ITERATIONS, hash: "SHA-256" }, raw, 256);
    const got = new Uint8Array(bits); const actual = fromB64(auth.hash); if (got.length !== actual.length) return false; let diff = 0; for (let i = 0; i < got.length; i += 1) diff |= got[i] ^ actual[i]; return diff === 0;
  }

  addControls();
})();
