#!/usr/bin/env bash
set -euo pipefail
BASE='v1.6.2'

git fetch --tags origin

# Restore the complete canonical source set from v1.6.2.
for f in CHANGELOG.md README.md managed_schema.json content.css content.js options.css options.html options.js options-pro.js privacy-policy.html background-v160.js manifest.json; do
  git show "$BASE:$f" > "$f"
done

python3 - <<'PY'
import json, subprocess, re
from pathlib import Path

base = 'v1.6.2'

def show(path):
    return subprocess.check_output(['git', 'show', f'{base}:{path}'], text=True)

# Manifest/version.
m = json.loads(show('manifest.json'))
m['version'] = '1.6.5'
m['permissions'] = ['tabs', 'storage', 'alarms', 'downloads']
m['host_permissions'] = ['<all_urls>']
m['background'] = {'service_worker': 'background-v165.js'}
m['options_page'] = 'options.html'
m['action'] = {'default_title': 'EdgeClose'}
Path('manifest.json').write_text(json.dumps(m, indent=2) + '\n')
Path('VERSION').write_text('1.6.5\n')

# Full background runtime from v1.6.2, then make only targeted changes.
bg = show('background-v160.js').replace('const VERSION = "1.6.0";', 'const VERSION = "1.6.5";')
# Remove legacy encrypted-config/recovery constants.
bg = bg.replace('const PUBLIC_KEY = "edgeclose-backup-public-key";\nconst BACKUP_PATH = "EdgeClose/config-audit.enc";\n', '')
# Replace audit with the single Download log writer.
audit = r'''let auditWriteQueue = Promise.resolve();
function auditDataUrl(value) {
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(value, null, 2))}`;
}
async function writeAuditFile(entries) {
  auditWriteQueue = auditWriteQueue.then(async () => {
    try {
      const existing = await chrome.downloads.search({ filename: "EdgeClose/audit-log.json" });
      const ids = existing.map((item) => item.id).filter(Number.isInteger);
      if (ids.length) await chrome.downloads.erase({ id: ids[0] }).catch(() => {});
      await chrome.downloads.download({
        url: auditDataUrl({ schemaVersion: 1, version: VERSION, generatedAt: Date.now(), events: entries.slice(0, MAX_AUDIT) }),
        filename: "EdgeClose/audit-log.json",
        saveAs: false,
        conflictAction: "overwrite"
      });
    } catch {}
  }).catch(() => {});
  return auditWriteQueue;
}
async function audit(event, metadata = {}) {
  const blocked = new Set(["password", "passwordHash", "salt", "token", "secret", "url", "pattern", "title"]);
  const safe = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (!blocked.has(key) && ["string", "number", "boolean"].includes(typeof value)) safe[key] = value;
  }
  const stored = await chrome.storage.local.get(AUDIT_KEY);
  const current = Array.isArray(stored[AUDIT_KEY]) ? stored[AUDIT_KEY] : [];
  const next = [{ timestamp: Date.now(), event: String(event).slice(0, 40), metadata: safe }, ...current].slice(0, MAX_AUDIT);
  await chrome.storage.local.set({ [AUDIT_KEY]: next });
  await writeAuditFile(next);
}
'''
start = bg.index('async function audit(event, metadata = {}) {')
end = bg.index('async function publicKey()', start)
bg = bg[:start] + audit + bg[end:]
# Remove legacy backup block between publicKey and onInstalled.
start = bg.index('async function publicKey()')
end = bg.index('chrome.runtime.onInstalled.addListener', start)
bg = bg[:start] + bg[end:]
# Remove all queueBackup calls and replace storage listener cleanly.
bg = re.sub(r'\s*queueBackup\(\);', '', bg)
start = bg.index('chrome.storage.onChanged.addListener')
end = bg.index('chrome.alarms.onAlarm.addListener', start)
listener = '''chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.sites || changes.patterns || changes[PAUSE_KEY] || changes["edgeclose-settings-password-hash"])) {
    reschedule();
    statusBroadcast();
  }
  if (area === "managed" && changes.sites) {
    reschedule();
    statusBroadcast();
  }
});
'''
bg = bg[:start] + listener + bg[end:]
# Add authenticated pause/resume implementation by replacing the original two functions.
auth = r'''const AUTH_HASH_KEY = "edgeclose-settings-password-hash";
const AUTH_SALT_KEY = "edgeclose-settings-password-salt";
const AUTH_ITERATIONS_KEY = "edgeclose-settings-password-iterations";
async function verifyActionPassword(password) {
  try {
    const stored = await chrome.storage.local.get([AUTH_HASH_KEY, AUTH_SALT_KEY, AUTH_ITERATIONS_KEY]);
    if (!stored[AUTH_HASH_KEY] || !stored[AUTH_SALT_KEY]) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password || "")), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Uint8Array.from(atob(stored[AUTH_SALT_KEY]), (c) => c.charCodeAt(0)), iterations: Number(stored[AUTH_ITERATIONS_KEY]) || 310000, hash: "SHA-256" }, key, 256);
    const actual = new Uint8Array(bits);
    const expected = Uint8Array.from(atob(stored[AUTH_HASH_KEY]), (c) => c.charCodeAt(0));
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < actual.length; i += 1) difference |= actual[i] ^ expected[i];
    return difference === 0;
  } catch {
    return false;
  }
}
'''
start = bg.index('async function setPause(minutes)')
end = bg.index('async function clearTabAlarmsAll()', start)
replacement = auth + '''async function setPause(minutes, password) {
  if (!(await verifyActionPassword(password))) return 0;
  const n = Math.max(1, Math.min(1440, Math.round(Number(minutes) || 15)));
  const until = Date.now() + n * 60000;
  await chrome.storage.local.set({ [PAUSE_KEY]: until });
  await clearTabAlarmsAll();
  await statusBroadcast();
  await audit("pause_set", { durationMinutes: n });
  return until;
}
async function resume(password) {
  if (!(await verifyActionPassword(password))) return false;
  await chrome.storage.local.remove(PAUSE_KEY);
  await chrome.alarms.clear(PAUSE_ALARM);
  await reschedule();
  await statusBroadcast();
  await audit("pause_cleared", {});
  return true;
}
'''
bg = bg[:start] + replacement + bg[end:]
bg = bg.replace('setPause(message.minutes).then', 'setPause(message.minutes, message.password).then')
bg = bg.replace('resume().then', 'resume(message.password).then')
# Make every successful alarm close definitive even if tab removal throws.
bg = bg.replace('await chrome.tabs.remove(id);', 'await chrome.tabs.remove(id).catch(() => {});')
Path('background-v165.js').write_text(bg)

# Content: preserve baseline timer engine; patch audio and exact deadline retry.
content = show('content.js')
if 'function initAudioFromGesture' not in content:
    content = content.replace('let audioContext;\n', 'let audioContext;\nlet deadlineRetryTimer;\n')
    old = '''function playWarningSound() {
  try {
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === "suspended") audioContext.resume();'''
    new = '''function initAudioFromGesture() {
  if (!soundEnabled || audioContext) return;
  try {
    audioContext = new AudioContext();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  } catch {
    audioContext = null;
  }
}
function playWarningSound() {
  try {
    if (!audioContext || audioContext.state !== "running") return;'''
    content = content.replace(old, new)
    old2 = '''    if (soundEnabled && !audioContext) {
      try { audioContext = new AudioContext(); } catch { audioContext = null; }
    }
    if (soundEnabled && audioContext?.state === "suspended") audioContext.resume().catch(() => {});'''
    content = content.replace(old2, '    initAudioFromGesture();')
# Replace deadline function robustly.
start = content.index('function armDeadlineTimer() {')
end = content.index('\n}\n\nchrome.runtime.onMessage.addListener', start) + 2
content = content[:start] + '''function armDeadlineTimer() {
  window.clearTimeout(deadlineTimer);
  window.clearInterval(deadlineRetryTimer);
  if (!deadlineAt || !scheduleActive || window.top !== window) return;
  const trigger = () => chrome.runtime.sendMessage({ type: "edgeclose-deadline" }).catch(() => {});
  const delay = Math.max(0, deadlineAt - Date.now());
  deadlineTimer = window.setTimeout(() => {
    trigger();
    let attempts = 0;
    deadlineRetryTimer = window.setInterval(() => {
      attempts += 1;
      if (!scheduleActive || Date.now() + 1000 < deadlineAt || attempts > 8) {
        window.clearInterval(deadlineRetryTimer);
        return;
      }
      trigger();
    }, 1000);
  }, delay);
}''' + content[end:]
content = content.replace('window.clearTimeout(deadlineTimer);\n    deadlineAt = 0;', 'window.clearTimeout(deadlineTimer);\n    window.clearInterval(deadlineRetryTimer);\n    deadlineAt = 0;')
Path('content.js').write_text(content)

# Options HTML/JS: preserve complete baseline UI/auth, remove downloads/release polling, add current Pro helper.
html = show('options.html')
html = html.replace('<script src="backup-lifecycle.js"></script>', '')
html = html.replace('EdgeClose checks published releases for newer versions. Passwords and browsing data are never included.', 'Microsoft Edge manages updates for extensions installed from the Microsoft Edge Add-ons Store.')
html = html.replace('<ul id="available-versions" class="version-list" aria-label="Available releases"></ul>', '')
html = html.replace('<button type="button" id="check-updates" class="text-button">Check now</button>', '')
html = html.replace('<script src="options-pro.js"></script>', '<script src="options-pro-v165.js"></script>')
Path('options.html').write_text(html)

opts = show('options.js')
start = opts.index('async function checkForUpdates() {')
end = opts.index('\n\ncheckUpdatesButton.addEventListener', start)
opts = opts[:start] + "async function checkForUpdates() { if (updateStatus) updateStatus.textContent = 'Microsoft Edge manages updates for Store-installed extensions.'; if (availableVersion) availableVersion.textContent = currentVersion; if (availableVersions) availableVersions.replaceChildren(); }" + opts[end:]
opts = opts.replace('checkUpdatesButton.addEventListener("click", checkForUpdates);', 'checkUpdatesButton?.addEventListener?.("click", checkForUpdates);')
opts = opts.replace('async function loadAuditLog() {\n  const entries', 'async function loadAuditLog() {\n  if (!auditList || !auditEmpty) return;\n  const entries')
opts = opts.replace('async function refreshDashboard() {\n  const state', 'async function refreshDashboard() {\n  if (!policySource || !policyPrecedence || !ruleCount || !monitoredCount || !protectionState || !pauseState) return;\n  const state')
opts = opts.replace('function unlockSettings() {\n  authGate.hidden = true;', 'function unlockSettings() {\n  if (!authGate || !protectedContent) return;\n  authGate.hidden = true;')
Path('options.js').write_text(opts)

pro = '''(() => {
  const $ = (selector) => document.querySelector(selector);
  const style = document.createElement('style');
  style.textContent = `.ec165-card{margin:0 0 18px;padding:22px;border:1px solid #dbe4e7;border-radius:16px;background:#fff;box-shadow:0 14px 34px rgba(20,47,58,.07)}.ec165-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.ec165-kicker{margin:0 0 6px;color:#1f6feb;font-size:.7rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.ec165-head h2{margin:0;font-size:1.12rem}.ec165-copy{margin:7px 0 16px;color:#66767d;font-size:.82rem;line-height:1.5}.ec165-pill{display:inline-flex;padding:7px 10px;border-radius:999px;background:#eaf8f1;color:#16835b;font-size:.7rem;font-weight:850;white-space:nowrap}.ec165-pill.paused{background:#fff6de;color:#a36a00}.ec165-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.ec165-actions button{padding:11px 8px;border:1px solid #dbe4e7;border-radius:10px;background:#f7fafb;color:#172329;font:800 .78rem Inter,sans-serif;cursor:pointer}.ec165-actions button:hover{border-color:#91b5ee;background:#eaf2ff;color:#1757bd}.ec165-actions .wide{grid-column:1/-1;background:#eaf8f1;border-color:#c7e8d8;color:#16835b}.ec165-modal{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(13,25,32,.46)}.ec165-modal[hidden]{display:none}.ec165-dialog{width:min(100%,410px);padding:24px;border:1px solid #dbe4e7;border-radius:16px;background:#fff;box-shadow:0 24px 80px rgba(13,25,32,.25)}.ec165-dialog h2{margin:0 0 7px;font-size:1.15rem}.ec165-dialog p{margin:0 0 15px;color:#66767d;font-size:.8rem;line-height:1.5}.ec165-dialog form{display:grid;gap:10px}.ec165-dialog input{max-width:none}.ec165-dialog-actions{display:flex;justify-content:flex-end;gap:8px}.ec165-status{min-height:18px;color:#b23b36;font-size:.76rem;font-weight:700}@media(max-width:700px){.ec165-actions{grid-template-columns:1fr}.ec165-actions .wide{grid-column:auto}}`;
  document.head.append(style);
  function askPassword(type, minutes, label) {
    return new Promise((resolve) => {
      const modal = document.createElement('div'); modal.className = 'ec165-modal';
      modal.innerHTML = `<div class="ec165-dialog" role="dialog" aria-modal="true" aria-labelledby="ec165-title"><h2 id="ec165-title">Password required</h2><p>${label}</p><form id="ec165-form"><input id="ec165-password" type="password" autocomplete="current-password" required><div class="ec165-dialog-actions"><button type="button" id="ec165-cancel" class="text-button">Cancel</button><button type="submit" class="primary-button">Confirm</button></div><p id="ec165-error" class="ec165-status"></p></form></div>`;
      document.body.append(modal);
      const form = modal.querySelector('#ec165-form'); const input = modal.querySelector('#ec165-password'); const error = modal.querySelector('#ec165-error');
      const close = () => { modal.remove(); resolve(false); };
      modal.querySelector('#ec165-cancel').addEventListener('click', close, { once: true });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const result = await chrome.runtime.sendMessage({ type, minutes, password: input.value }).catch(() => ({ ok: false }));
        input.value = '';
        if (!result?.ok) { error.textContent = 'Incorrect password or action unavailable.'; input.focus(); return; }
        modal.remove(); resolve(true);
      }, { once: true });
      input.focus();
    });
  }
  function inject() {
    const root = $('#protected-content'); if (!root || $('#ec165-controls')) return;
    const section = document.createElement('section'); section.id = 'ec165-controls'; section.className = 'ec165-card';
    section.innerHTML = '<div class="ec165-head"><div><p class="ec165-kicker">Protection control</p><h2>Temporary pause</h2><p class="ec165-copy">Pause and resume are available only from this password-protected Options page.</p></div><span id="ec165-pill" class="ec165-pill">Protection ON</span></div><div class="ec165-actions"><button type="button" data-ec165="15">15 minutes</button><button type="button" data-ec165="60">1 hour</button><button type="button" data-ec165="1440">24 hours</button><button type="button" id="ec165-resume" class="wide">Resume protection</button></div>';
    root.insertBefore(section, root.firstChild);
    const refresh = async () => { const state = await chrome.runtime.sendMessage({ type: 'edgeclose-admin-state' }).catch(() => null); const pill = $('#ec165-pill'); if (pill && state) { pill.textContent = state.paused ? 'Protection paused' : 'Protection ON'; pill.classList.toggle('paused', Boolean(state.paused)); } };
    section.querySelectorAll('[data-ec165]').forEach((button) => button.addEventListener('click', () => askPassword('edgeclose-pause', Number(button.dataset.ec165), 'Enter your settings password to pause protection.').then(refresh)));
    $('#ec165-resume').addEventListener('click', () => askPassword('edgeclose-resume', 0, 'Enter your settings password to resume protection.').then(refresh));
    refresh();
  }
  inject();
})();
'''
Path('options-pro-v165.js').write_text(pro)

# Privacy/changelog aligned with actual behavior.
pp = Path('privacy-policy.html').read_text()
pp = re.sub(r'(?is)<h2>Encrypted backup</h2>.*?<h2>Audit log</h2>', '<h2>Local audit log</h2><p>EdgeClose maintains a bounded management audit log locally and one current copy at <code>Downloads/EdgeClose/audit-log.json</code>. Configuration and recovery backups are not downloaded automatically.</p><p>The audit file contains management events only and excludes passwords, URLs, page titles, page contents and rule patterns.</p><h2>Audit log</h2>', pp)
pp = re.sub(r'(?is)The Options page may request public release metadata.*?request\.', 'EdgeClose does not contact GitHub or another remote update service to check versions. Microsoft Edge manages updates for Store-installed extensions.', pp)
Path('privacy-policy.html').write_text(pp)

ch = show('CHANGELOG.md')
entry = '''## v1.6.5\n\n- Rebuilt from the complete v1.6.2 source baseline and kept the full timer/settings engine.\n- Use a self-contained v1.6.5 service worker with no cross-version dependency.\n- Options page is the single control surface; no popup.\n- Pause/resume requires password confirmation.\n- Keep only one audit file in `Downloads/EdgeClose/audit-log.json`; no configuration/recovery backup downloads.\n- Remove GitHub release polling; Microsoft Edge manages Store-installed updates.\n- Fix Options null-reference crashes and gesture-only warning audio.\n- Strengthen exact deadline closure with retry handling.\n\n'''
Path('CHANGELOG.md').write_text(entry + ch)

# Remove obsolete files from current source tree.
for name in ['background-v160.js','background-v163.js','background-v164.js','options-pro.js','options-pro-v163.js','options-pro-v164.js','backup-lifecycle.js','popup.html','popup.css','popup.js','rebuild-v165.yml','rebuild-v165-clean.sh']:
  p=Path(name)
  if p.exists(): p.unlink()
# Remove legacy migration workflow files if present.
for p in Path('.github/workflows').glob('*v163*'):
  p.unlink()
PY

# Final local validation for the rebuilt source.
node --check background-v165.js
node --check content.js
node --check options.js
node --check options-pro-v165.js
node -e "const fs=require('fs');const m=require('./manifest.json');const v=fs.readFileSync('VERSION','utf8').trim();if(m.version!==v||v!=='1.6.5')throw Error('Version mismatch');if(m.background.service_worker!=='background-v165.js')throw Error('Wrong worker');if(m.host_permissions.includes('https://api.github.com/*'))throw Error('GitHub permission remains');const required=['manifest.json','background-v165.js','content.js','content.css','options.html','options.css','options.js','options-pro-v165.js','managed_schema.json','privacy-policy.html'];for(const f of required)if(!fs.existsSync(f))throw Error('Missing '+f);for(const f of ['popup.html','popup.js','backup-lifecycle.js','background-v163.js'])if(fs.existsSync(f))throw Error('Obsolete '+f);const h=fs.readFileSync('options.html','utf8');if(h.includes('backup-lifecycle.js')||h.includes('options-pro.js')||h.includes('popup.js'))throw Error('Stale options reference');if(!fs.readFileSync('background-v165.js','utf8').includes('function verifyActionPassword'))throw Error('Auth missing');if(!fs.readFileSync('background-v165.js','utf8').includes('EdgeClose/audit-log.json'))throw Error('Audit writer missing');"
