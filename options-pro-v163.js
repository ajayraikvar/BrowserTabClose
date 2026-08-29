(() => {
  const AUTH_HASH = "edgeclose-settings-password-hash";
  const AUTH_SALT = "edgeclose-settings-password-salt";
  const AUTH_ITERATIONS = "edgeclose-settings-password-iterations";
  const DEFAULT_ITERATIONS = 310000;
  const $ = (selector) => document.querySelector(selector);
  const fromB64 = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  const encoder = new TextEncoder();

  async function verifyPassword(password) {
    const stored = await chrome.storage.local.get([AUTH_HASH, AUTH_SALT, AUTH_ITERATIONS]);
    if (!stored[AUTH_HASH] || !stored[AUTH_SALT]) return false;
    const raw = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromB64(stored[AUTH_SALT]), iterations: Number(stored[AUTH_ITERATIONS]) || DEFAULT_ITERATIONS, hash: "SHA-256" }, raw, 256);
    const expected = fromB64(stored[AUTH_HASH]);
    const actual = new Uint8Array(bits);
    if (expected.length !== actual.length) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index];
    return difference === 0;
  }

  function inject() {
    const root = $("#protected-content");
    if (!root || $("#edgeclose-protection-controls")) return;
    const style = document.createElement("style");
    style.textContent = `.ec163-card{margin:0 0 18px;padding:22px;border:1px solid #dbe4e7;border-radius:16px;background:#fff;box-shadow:0 14px 34px rgba(20,47,58,.07)}.ec163-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.ec163-kicker{margin:0 0 6px;color:#1f6feb;font-size:.7rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.ec163-head h2{margin:0;font-size:1.12rem}.ec163-copy{margin:7px 0 16px;color:#66767d;font-size:.82rem;line-height:1.5}.ec163-pill{display:inline-flex;padding:7px 10px;border-radius:999px;background:#eaf8f1;color:#16835b;font-size:.7rem;font-weight:850;white-space:nowrap}.ec163-pill.paused{background:#fff6de;color:#a36a00}.ec163-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.ec163-actions button{padding:11px 8px;border:1px solid #dbe4e7;border-radius:10px;background:#f7fafb;color:#172329;font:800 .78rem Inter,sans-serif;cursor:pointer}.ec163-actions button:hover{border-color:#91b5ee;background:#eaf2ff;color:#1757bd}.ec163-actions .wide{grid-column:1/-1;background:#eaf8f1;border-color:#c7e8d8;color:#16835b}.ec163-modal{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(13,25,32,.46)}.ec163-modal[hidden]{display:none}.ec163-dialog{width:min(100%,410px);padding:24px;border:1px solid #dbe4e7;border-radius:16px;background:#fff;box-shadow:0 24px 80px rgba(13,25,32,.25)}.ec163-dialog h2{margin:0 0 7px;font-size:1.15rem}.ec163-dialog p{margin:0 0 15px;color:#66767d;font-size:.8rem;line-height:1.5}.ec163-dialog form{display:grid;gap:10px}.ec163-dialog input{max-width:none}.ec163-dialog-actions{display:flex;justify-content:flex-end;gap:8px}.ec163-error{min-height:18px;color:#b23b36;font-size:.76rem;font-weight:700}@media(max-width:700px){.ec163-actions{grid-template-columns:1fr}.ec163-actions .wide{grid-column:auto}}`;
    document.head.append(style);

    const section = document.createElement("section");
    section.id = "edgeclose-protection-controls";
    section.className = "ec163-card";
    section.innerHTML = `<div class="ec163-head"><div><p class="ec163-kicker">Protection control</p><h2>Temporary pause</h2><p class="ec163-copy">Pause and resume are available only from this page. Every action requires your settings password.</p></div><span id="ec163-pill" class="ec163-pill">Protection ON</span></div><div class="ec163-actions"><button type="button" data-ec-pause="15">15 minutes</button><button type="button" data-ec-pause="60">1 hour</button><button type="button" data-ec-pause="1440">24 hours</button><button id="ec163-resume" type="button" class="wide">Resume protection</button></div>`;
    root.insertBefore(section, root.children[1] || root.firstChild);

    const modal = document.createElement("div");
    modal.className = "ec163-modal";
    modal.hidden = true;
    modal.innerHTML = `<div class="ec163-dialog" role="dialog" aria-modal="true" aria-labelledby="ec163-auth-title"><h2 id="ec163-auth-title">Password required</h2><p id="ec163-auth-copy">Enter your settings password to continue.</p><form id="ec163-auth-form"><input id="ec163-auth-password" type="password" autocomplete="current-password" required><div class="ec163-dialog-actions"><button id="ec163-auth-cancel" type="button" class="text-button">Cancel</button><button type="submit" class="primary-button">Confirm</button></div><p id="ec163-auth-error" class="ec163-error"></p></form></div>`;
    document.body.append(modal);

    const askPassword = (copy, action) => new Promise((resolve) => {
      $("#ec163-auth-copy").textContent = copy;
      $("#ec163-auth-password").value = "";
      $("#ec163-auth-error").textContent = "";
      modal.hidden = false;
      const cancel = () => { modal.hidden = true; cleanup(); resolve(false); };
      const submit = async (event) => {
        event.preventDefault();
        const password = $("#ec163-auth-password").value;
        if (!(await verifyPassword(password))) { $("#ec163-auth-error").textContent = "Incorrect password."; return; }
        modal.hidden = true;
        cleanup();
        await action();
        resolve(true);
      };
      const cleanup = () => {
        $("#ec163-auth-cancel").removeEventListener("click", cancel);
        $("#ec163-auth-form").removeEventListener("submit", submit);
      };
      $("#ec163-auth-cancel").addEventListener("click", cancel);
      $("#ec163-auth-form").addEventListener("submit", submit);
      $("#ec163-auth-password").focus();
    });

    const refresh = async () => {
      const state = await chrome.runtime.sendMessage({ type: "edgeclose-admin-state" }).catch(() => null);
      const pill = $("#ec163-pill");
      if (pill && state) {
        pill.textContent = state.paused ? "Protection paused" : "Protection ON";
        pill.classList.toggle("paused", !!state.paused);
      }
    };

    section.querySelectorAll("[data-ec-pause]").forEach((button) => button.addEventListener("click", () => askPassword("Enter your settings password to pause protection.", async () => {
      await chrome.runtime.sendMessage({ type: "edgeclose-pause", minutes: Number(button.dataset.ecPause) });
      await refresh();
    })));
    $("#ec163-resume").addEventListener("click", () => askPassword("Enter your settings password to resume protection.", async () => {
      await chrome.runtime.sendMessage({ type: "edgeclose-resume" });
      await refresh();
    }));
    refresh();
  }

  inject();
})();
