#!/usr/bin/env python3
import json, re, subprocess
from pathlib import Path

BASE = 'v1.6.2'
ROOT = Path('.')

def show(path):
    return subprocess.check_output(['git', 'show', f'{BASE}:{path}'], text=True)

# Restore complete v1.6.2 source baseline for all runtime/UI files.
for name in ['CHANGELOG.md','README.md','managed_schema.json','content.css','content.js','options.css','options.html','options.js','privacy-policy.html','background-v160.js','manifest.json']:
    (ROOT / name).write_text(show(name))

m = json.loads((ROOT / 'manifest.json').read_text())
m['version'] = '1.6.6'
m['permissions'] = ['tabs','storage','alarms','downloads']
m['host_permissions'] = ['<all_urls>']
m['background'] = {'service_worker':'background-v166.js'}
m['options_page'] = 'options.html'
m['action'] = {'default_title':'EdgeClose'}
(ROOT / 'manifest.json').write_text(json.dumps(m, indent=2) + '\n')
(ROOT / 'VERSION').write_text('1.6.6\n')

# Full timer/rule engine from the v1.6.2 baseline; make it self-contained.
bg = show('background-v160.js').replace('const VERSION = "1.6.0";', 'const VERSION = "1.6.6";')
bg = bg.replace('const PUBLIC_KEY = "edgeclose-backup-public-key";\nconst BACKUP_PATH = "EdgeClose/config-audit.enc";\n', '')
# Remove legacy backup helpers between publicKey and install handling.
a = bg.index('async function publicKey()')
b = bg.index('chrome.runtime.onInstalled.addListener', a)
bg = bg[:a] + bg[b:]
# Replace audit with one current Downloads copy only.
a = bg.index('async function audit(event, metadata = {}) {')
b = bg.index('async function closeIfDue', a)
audit = '''async function audit(event, metadata = {}) {\n  const blocked = new Set(["password","passwordHash","salt","token","secret","url","pattern","title"]);\n  const safe = {};\n  for (const [key, value] of Object.entries(metadata || {})) if (!blocked.has(key) && ["string","number","boolean"].includes(typeof value)) safe[key] = value;\n  const stored = await chrome.storage.local.get(AUDIT_KEY);\n  const current = Array.isArray(stored[AUDIT_KEY]) ? stored[AUDIT_KEY] : [];\n  const next = [{ timestamp: Date.now(), event: String(event).slice(0, 40), metadata: safe }, ...current].slice(0, MAX_AUDIT);\n  await chrome.storage.local.set({ [AUDIT_KEY]: next });\n  if (!audit.writeQueue) audit.writeQueue = Promise.resolve();\n  audit.writeQueue = audit.writeQueue.then(async () => {\n    try {\n      const found = await chrome.downloads.search({ filename: "EdgeClose/audit-log.json" });\n      for (const item of found) if (Number.isInteger(item.id)) await chrome.downloads.erase({ id: item.id }).catch(() => {});\n      const payload = { schemaVersion: 1, version: VERSION, generatedAt: Date.now(), events: next };\n      await chrome.downloads.download({\n        url: `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`,\n        filename: "EdgeClose/audit-log.json", saveAs: false, conflictAction: "overwrite"\n      });\n    } catch {}\n  }).catch(() => {});\n}\n\n'''
bg = bg[:a] + audit + bg[b:]
bg = bg.replace('queueBackup();', '')
# Authenticated pause/resume with correct response status.
a = bg.index('async function setPause(minutes)')
b = bg.index('async function clearTabAlarmsAll()', a)
auth_pause = '''const AUTH_HASH_KEY = "edgeclose-settings-password-hash";\nconst AUTH_SALT_KEY = "edgeclose-settings-password-salt";\nconst AUTH_ITERATIONS_KEY = "edgeclose-settings-password-iterations";\nasync function verifyActionPassword(password) {\n  try {\n    const stored = await chrome.storage.local.get([AUTH_HASH_KEY, AUTH_SALT_KEY, AUTH_ITERATIONS_KEY]);\n    if (!stored[AUTH_HASH_KEY] || !stored[AUTH_SALT_KEY]) return false;\n    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password || "")), "PBKDF2", false, ["deriveBits"]);\n    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Uint8Array.from(atob(stored[AUTH_SALT_KEY]), c => c.charCodeAt(0)), iterations: Number(stored[AUTH_ITERATIONS_KEY]) || 310000, hash: "SHA-256" }, key, 256);\n    const actual = new Uint8Array(bits);\n    const expected = Uint8Array.from(atob(stored[AUTH_HASH_KEY]), c => c.charCodeAt(0));\n    if (actual.length !== expected.length) return false;\n    let diff = 0;\n    for (let i = 0; i < actual.length; i += 1) diff |= actual[i] ^ expected[i];\n    return diff === 0;\n  } catch { return false; }\n}\nasync function setPause(minutes, password) {\n  if (!(await verifyActionPassword(password))) return 0;\n  const n = Math.max(1, Math.min(1440, Math.round(Number(minutes) || 15)));\n  const until = Date.now() + n * 60000;\n  await chrome.storage.local.set({ [PAUSE_KEY]: until });\n  await clearTabAlarmsAll(); await statusBroadcast(); await audit("pause_set", { durationMinutes: n });\n  return until;\n}\nasync function resume(password) {\n  if (!(await verifyActionPassword(password))) return false;\n  await chrome.storage.local.remove(PAUSE_KEY); await chrome.alarms.clear(PAUSE_ALARM);\n  await reschedule(); await statusBroadcast(); await audit("pause_cleared", {});\n  return true;\n}\n'''
bg = bg[:a] + auth_pause + bg[b:]
bg = bg.replace('setPause(message.minutes).then((until) => sendResponse({ ok: true, pauseUntil: until }))', 'setPause(message.minutes, message.password).then((until) => sendResponse({ ok: until > 0, pauseUntil: until }))')
bg = bg.replace('resume().then(() => sendResponse({ ok: true }))', 'resume(message.password).then((ok) => sendResponse({ ok }))')
bg = bg.replace('if (message.type === "edgeclose-backup-now") { encryptedBackup().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false })); return true; }', '')
(ROOT / 'background-v166.js').write_text(bg)

# Content: preserve baseline, fix AudioContext policy and add deadline retry.
content = show('content.js').replace('let audioContext;', 'let audioContext;\nlet deadlineRetryTimer;')
content = content.replace('''function playWarningSound() {\n  try {\n    if (!audioContext) audioContext = new AudioContext();\n    if (audioContext.state === "suspended") audioContext.resume();''', '''function initAudioFromGesture() {\n  if (!soundEnabled || audioContext) return;\n  try { audioContext = new AudioContext(); if (audioContext.state === "suspended") audioContext.resume().catch(() => {}); } catch { audioContext = null; }\n}\nfunction playWarningSound() {\n  try {\n    if (!audioContext || audioContext.state !== "running") return;''')
content = content.replace('''    if (soundEnabled && !audioContext) {\n      try { audioContext = new AudioContext(); } catch { audioContext = null; }\n    }\n    if (soundEnabled && audioContext?.state === "suspended") audioContext.resume().catch(() => {});''', '    initAudioFromGesture();')
a = content.index('function armDeadlineTimer() {')
b = content.index('\n}\n\nchrome.runtime.onMessage.addListener', a) + 2
content = content[:a] + '''function armDeadlineTimer() {\n  window.clearTimeout(deadlineTimer); window.clearInterval(deadlineRetryTimer);\n  if (!deadlineAt || !scheduleActive || window.top !== window) return;\n  const trigger = () => chrome.runtime.sendMessage({ type: "edgeclose-deadline" }).catch(() => {});\n  const delay = Math.max(0, deadlineAt - Date.now());\n  deadlineTimer = window.setTimeout(() => {\n    trigger();\n    let attempts = 0;\n    deadlineRetryTimer = window.setInterval(() => {\n      attempts += 1;\n      if (!scheduleActive || Date.now() + 1000 < deadlineAt || attempts > 8) { window.clearInterval(deadlineRetryTimer); return; }\n      trigger();\n    }, 1000);\n  }, delay);\n}''' + content[b:]
content = content.replace('window.clearTimeout(deadlineTimer);\n    deadlineAt = 0;', 'window.clearTimeout(deadlineTimer);\n    window.clearInterval(deadlineRetryTimer);\n    deadlineAt = 0;')
(ROOT / 'content.js').write_text(content)

# Options: full baseline auth/settings UI, no backup updater, no GitHub polling.
html = show('options.html').replace('<script src="backup-lifecycle.js"></script>', '').replace('<script src="options-pro.js"></script>', '<script src="options-pro-v166.js"></script>').replace('EdgeClose checks published releases for newer versions. Passwords and browsing data are never included.', 'Microsoft Edge manages updates for extensions installed from the Microsoft Edge Add-ons Store.').replace('<ul id="available-versions" class="version-list" aria-label="Available releases"></ul>', '').replace('<button type="button" id="check-updates" class="text-button">Check now</button>', '')
(ROOT / 'options.html').write_text(html)
opts = show('options.js')
a = opts.index('async function checkForUpdates() {')
b = opts.index('\n\ncheckUpdatesButton.addEventListener', a)
opts = opts[:a] + "async function checkForUpdates(){if(updateStatus)updateStatus.textContent='Microsoft Edge manages updates for Store-installed extensions.';if(availableVersion)availableVersion.textContent=currentVersion;if(availableVersions)availableVersions.replaceChildren();}" + opts[b:]
opts = opts.replace('checkUpdatesButton.addEventListener("click", checkForUpdates);', 'checkUpdatesButton?.addEventListener?.("click", checkForUpdates);').replace('async function loadAuditLog() {\n  const entries', 'async function loadAuditLog() {\n  if(!auditList||!auditEmpty)return;\n  const entries').replace('async function refreshDashboard() {\n  const state', 'async function refreshDashboard() {\n  if(!policySource||!policyPrecedence||!ruleCount||!monitoredCount||!protectionState||!pauseState)return;\n  const state').replace('function unlockSettings() {\n  authGate.hidden = true;', 'function unlockSettings() {\n  if(!authGate||!protectedContent)return;\n  authGate.hidden = true;')
(ROOT / 'options.js').write_text(opts)

# Pro pause control; settings page remains the sole control surface.
(ROOT / 'options-pro-v166.js').write_text(r'''(()=>{const $=s=>document.querySelector(s);const st=document.createElement("style");st.textContent='.ec166-card{margin:0 0 18px;padding:22px;border:1px solid #dbe4e7;border-radius:16px;background:#fff;box-shadow:0 14px 34px rgba(20,47,58,.07)}.ec166-head{display:flex;justify-content:space-between;gap:18px}.ec166-kicker{margin:0 0 6px;color:#1f6feb;font-size:.7rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.ec166-head h2{margin:0;font-size:1.12rem}.ec166-copy{margin:7px 0 16px;color:#66767d;font-size:.82rem;line-height:1.5}.ec166-pill{display:inline-flex;padding:7px 10px;border-radius:999px;background:#eaf8f1;color:#16835b;font-size:.7rem;font-weight:850}.ec166-pill.paused{background:#fff6de;color:#a36a00}.ec166-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.ec166-actions button{padding:11px 8px;border:1px solid #dbe4e7;border-radius:10px;background:#f7fafb;color:#172329;font:800 .78rem Inter,sans-serif;cursor:pointer}.ec166-actions .wide{grid-column:1/-1;background:#eaf8f1;border-color:#c7e8d8;color:#16835b}.ec166-modal{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(13,25,32,.46)}.ec166-dialog{width:min(100%,410px);padding:24px;border:1px solid #dbe4e7;border-radius:16px;background:#fff;box-shadow:0 24px 80px rgba(13,25,32,.25)}.ec166-dialog form{display:grid;gap:10px}.ec166-dialog-actions{display:flex;justify-content:flex-end;gap:8px}.ec166-status{min-height:18px;color:#b23b36;font-size:.76rem;font-weight:700}@media(max-width:700px){.ec166-actions{grid-template-columns:1fr}.ec166-actions .wide{grid-column:auto}}';document.head.append(st);function ask(type,minutes,label){return new Promise(resolve=>{const m=document.createElement("div");m.className="ec166-modal";m.innerHTML=`<div class="ec166-dialog" role="dialog" aria-modal="true"><h2>Password required</h2><p>${label}</p><form><input type="password" id="ec166-password" autocomplete="current-password" required><div class="ec166-dialog-actions"><button type="button" id="ec166-cancel" class="text-button">Cancel</button><button type="submit" class="primary-button">Confirm</button></div><p id="ec166-error" class="ec166-status"></p></form></div>`;document.body.append(m);const f=m.querySelector("form"),p=m.querySelector("#ec166-password"),e=m.querySelector("#ec166-error");m.querySelector("#ec166-cancel").onclick=()=>{m.remove();resolve(false)};f.onsubmit=async ev=>{ev.preventDefault();const r=await chrome.runtime.sendMessage({type,minutes,password:p.value}).catch(()=>({ok:false}));p.value="";if(!r?.ok){e.textContent="Incorrect password or action unavailable.";p.focus();return;}m.remove();resolve(true)};p.focus()})}function inject(){const root=$("#protected-content");if(!root||$("#ec166-controls"))return;const s=document.createElement("section");s.id="ec166-controls";s.className="ec166-card";s.innerHTML='<div class="ec166-head"><div><p class="ec166-kicker">Protection control</p><h2>Temporary pause</h2><p class="ec166-copy">Pause and resume are available only from this password-protected Options page.</p></div><span id="ec166-pill" class="ec166-pill">Protection ON</span></div><div class="ec166-actions"><button type="button" data-ec166="15">15 minutes</button><button type="button" data-ec166="60">1 hour</button><button type="button" data-ec166="1440">24 hours</button><button type="button" id="ec166-resume" class="wide">Resume protection</button></div>';root.insertBefore(s,root.firstChild);const refresh=async()=>{const x=await chrome.runtime.sendMessage({type:"edgeclose-admin-state"}).catch(()=>null);const pill=$("#ec166-pill");if(pill&&x){pill.textContent=x.paused?"Protection paused":"Protection ON";pill.classList.toggle("paused",!!x.paused)}};s.querySelectorAll('[data-ec166]').forEach(b=>b.onclick=()=>ask('edgeclose-pause',Number(b.dataset.ec166),'Enter your settings password to pause protection.').then(refresh));$("#ec166-resume").onclick=()=>ask('edgeclose-resume',0,'Enter your settings password to resume protection.').then(refresh);refresh()}inject()})();''')

# Privacy/changelog alignment.
pp = (ROOT/'privacy-policy.html').read_text()
pp = re.sub(r'(?is)<h2>Encrypted backup</h2>.*?<h2>Audit log</h2>', '<h2>Local audit log</h2><p>EdgeClose maintains one current management log at <code>Downloads/EdgeClose/audit-log.json</code>. Configuration and recovery backups are not downloaded automatically.</p><p>The audit file contains management events only and does not record passwords, URLs, page titles, page contents, or rule patterns.</p><h2>Audit log</h2>', pp)
pp = re.sub(r'(?is)The Options page may request public release metadata.*?request\.', 'EdgeClose does not contact GitHub or another remote update service to check extension versions. Microsoft Edge manages updates for Store-installed extensions.', pp)
(ROOT/'privacy-policy.html').write_text(pp)
ch = show('CHANGELOG.md')
(ROOT/'CHANGELOG.md').write_text('## v1.6.6\n\n- Rebuilt from the complete v1.6.2 source baseline and restored the full timer/rule engine.\n- Self-contained v1.6.6 service worker; no cross-version import.\n- Pause/resume requires password confirmation and reports failed authentication correctly.\n- Options is the single control surface; no popup UI.\n- Maintain only one audit file in `Downloads/EdgeClose/audit-log.json`; no automatic configuration/recovery downloads.\n- Microsoft Edge manages Store-installed updates; GitHub version polling removed.\n- Fixed Options null-reference handling and AudioContext gesture policy.\n- Strengthened exact deadline closure with retry handling.\n\n'+ch)

# Remove obsolete files from current source tree.
for name in ['background-v160.js','background-v163.js','background-v164.js','background-v165.js','options-pro.js','options-pro-v163.js','options-pro-v164.js','options-pro-v165.js','backup-lifecycle.js','popup.html','popup.css','popup.js']:
    p=ROOT/name
    if p.exists(): p.unlink()
for p in ROOT.glob('EdgeClose-*.zip'): p.unlink()
PY

node --check background-v166.js
node --check content.js
node --check options.js
node --check options-pro-v166.js
node -e "const fs=require('fs'),m=require('./manifest.json');const v=fs.readFileSync('VERSION','utf8').trim();if(v!=='1.6.6'||m.version!==v)throw Error('version mismatch');if(m.background.service_worker!=='background-v166.js')throw Error('worker');for(const f of ['manifest.json','background-v166.js','content.js','content.css','options.html','options.css','options.js','options-pro-v166.js','managed_schema.json','privacy-policy.html'])if(!fs.existsSync(f)||!fs.statSync(f).size)throw Error('missing '+f);for(const f of ['background-v160.js','background-v163.js','background-v164.js','background-v165.js','options-pro.js','options-pro-v163.js','options-pro-v164.js','options-pro-v165.js','backup-lifecycle.js','popup.js'])if(fs.existsSync(f))throw Error('obsolete '+f);const h=fs.readFileSync('options.html','utf8');if(h.includes('backup-lifecycle.js')||h.includes('options-pro.js')||h.includes('popup.js')||h.includes('api.github.com'))throw Error('stale options');if((m.host_permissions||[]).some(x=>x.includes('api.github.com')))throw Error('github permission');const b=fs.readFileSync('background-v166.js','utf8');for(const s of ['siteForTab','schedule','reschedule','closeIfDue','markActive','verifyActionPassword','EdgeClose/audit-log.json'])if(!b.includes(s))throw Error('missing core '+s);for(const s of ['importScripts(','edgeclose-backup-now','config-audit.enc','encryptedBackup','queueBackup'])if(b.includes(s))throw Error('legacy '+s);"
