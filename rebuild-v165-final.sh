#!/usr/bin/env bash
set -euo pipefail
BASE=v1.6.2

git fetch --tags origin

python3 - <<'PY'
import json, re, subprocess
from pathlib import Path
BASE='v1.6.2'
def show(path): return subprocess.check_output(['git','show',f'{BASE}:{path}'], text=True)
def between(text, start_marker, end_marker):
    a=text.index(start_marker); b=text.index(end_marker,a); return a,b

# Restore complete v1.6.2 source baseline.
for f in ['CHANGELOG.md','README.md','managed_schema.json','content.css','content.js','options.css','options.html','options.js','options-pro.js','privacy-policy.html','background-v160.js','manifest.json']:
    Path(f).write_text(show(f))

# Manifest + version.
m=json.loads(Path('manifest.json').read_text())
m['version']='1.6.5'
m['permissions']=['tabs','storage','alarms','downloads']
m['host_permissions']=['<all_urls>']
m['background']={'service_worker':'background-v165.js'}
m['options_page']='options.html'
m['action']={'default_title':'EdgeClose'}
Path('manifest.json').write_text(json.dumps(m,indent=2)+'\n')
Path('VERSION').write_text('1.6.5\n')

# Self-contained background runtime: preserve all v1.6.2 timer/rule logic, remove remote/config-backup machinery, add audit file + authenticated pause.
bg=show('background-v160.js').replace('const VERSION = "1.6.0";','const VERSION = "1.6.5";')
bg=bg.replace('const PUBLIC_KEY = "edgeclose-backup-public-key";\nconst BACKUP_PATH = "EdgeClose/config-audit.enc";\n','')
start,end=between(bg,'async function audit(event, metadata = {}) {','async function publicKey()')
audit='''async function audit(event, metadata = {}) {\n  const blocked = new Set(["password","passwordHash","salt","token","secret","url","pattern","title"]);\n  const safe = {};\n  for (const [key,value] of Object.entries(metadata || {})) if (!blocked.has(key) && ["string","number","boolean"].includes(typeof value)) safe[key]=value;\n  const stored = await chrome.storage.local.get(AUDIT_KEY);\n  const current = Array.isArray(stored[AUDIT_KEY]) ? stored[AUDIT_KEY] : [];\n  const next = [{timestamp:Date.now(),event:String(event).slice(0,40),metadata:safe},...current].slice(0,MAX_AUDIT);\n  await chrome.storage.local.set({[AUDIT_KEY]:next});\n  if (!audit.writeQueue) audit.writeQueue=Promise.resolve();\n  audit.writeQueue=audit.writeQueue.then(async()=>{\n    try {\n      const found=await chrome.downloads.search({filename:"EdgeClose/audit-log.json"});\n      for (const item of found.slice(0,1)) if (Number.isInteger(item.id)) await chrome.downloads.erase({id:item.id}).catch(()=>{});\n      await chrome.downloads.download({url:`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({schemaVersion:1,version:VERSION,generatedAt:Date.now(),events:next},null,2))}`,filename:"EdgeClose/audit-log.json",saveAs:false,conflictAction:"overwrite"});\n    } catch {}\n  }).catch(()=>{});\n}\n'''
bg=bg[:start]+audit+bg[end:]
# Remove publicKey/encryptedBackup/queueBackup region.
start=bg.index('async function publicKey()'); end=bg.index('chrome.runtime.onInstalled.addListener',start); bg=bg[:start]+bg[end:]
# Replace pause/resume functions.
start,end=between(bg,'async function setPause(minutes)','async function clearTabAlarmsAll()')
auth='''const AUTH_HASH_KEY="edgeclose-settings-password-hash";\nconst AUTH_SALT_KEY="edgeclose-settings-password-salt";\nconst AUTH_ITERATIONS_KEY="edgeclose-settings-password-iterations";\nasync function verifyActionPassword(password){try{const s=await chrome.storage.local.get([AUTH_HASH_KEY,AUTH_SALT_KEY,AUTH_ITERATIONS_KEY]);if(!s[AUTH_HASH_KEY]||!s[AUTH_SALT_KEY])return false;const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(password||"")),"PBKDF2",false,["deriveBits"]);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:Uint8Array.from(atob(s[AUTH_SALT_KEY]),c=>c.charCodeAt(0)),iterations:Number(s[AUTH_ITERATIONS_KEY])||310000,hash:"SHA-256"},key,256);const a=new Uint8Array(bits),e=Uint8Array.from(atob(s[AUTH_HASH_KEY]),c=>c.charCodeAt(0));if(a.length!==e.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^e[i];return d===0;}catch{return false;}}\nasync function setPause(minutes,password){if(!(await verifyActionPassword(password)))return 0;const n=Math.max(1,Math.min(1440,Math.round(Number(minutes)||15)));const until=Date.now()+n*60000;await chrome.storage.local.set({[PAUSE_KEY]:until});await clearTabAlarmsAll();await statusBroadcast();await audit("pause_set",{durationMinutes:n});return until;}\nasync function resume(password){if(!(await verifyActionPassword(password)))return false;await chrome.storage.local.remove(PAUSE_KEY);await chrome.alarms.clear(PAUSE_ALARM);await reschedule();await statusBroadcast();await audit("pause_cleared",{});return true;}\n'''
bg=bg[:start]+auth+bg[end:]
bg=bg.replace('setPause(message.minutes).then','setPause(message.minutes,message.password).then').replace('resume().then','resume(message.password).then')
# Replace storage watcher without queueBackup.
start=bg.index('chrome.storage.onChanged.addListener'); end=bg.index('chrome.alarms.onAlarm.addListener',start)
bg=bg[:start]+'''chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local"&&(changes.sites||changes.patterns||changes[PAUSE_KEY]||changes[AUTH_HASH_KEY])){reschedule();statusBroadcast();}if(area==="managed"&&changes.sites){reschedule();statusBroadcast();}});\n'''+bg[end:]
Path('background-v165.js').write_text(bg)

# Content: baseline + gesture-only audio + deadline retry.
content=show('content.js')
content=content.replace('let audioContext;','let audioContext;\nlet deadlineRetryTimer;')
content=content.replace('''function playWarningSound() {\n  try {\n    if (!audioContext) audioContext = new AudioContext();\n    if (audioContext.state === "suspended") audioContext.resume();''','''function initAudioFromGesture(){\n  if(!soundEnabled||audioContext)return;\n  try{audioContext=new AudioContext();if(audioContext.state==="suspended")audioContext.resume().catch(()=>{});}catch{audioContext=null;}\n}\nfunction playWarningSound(){\n  try{\n    if(!audioContext||audioContext.state!=="running")return;''')
content=content.replace('''    if (soundEnabled && !audioContext) {\n      try { audioContext = new AudioContext(); } catch { audioContext = null; }\n    }\n    if (soundEnabled && audioContext?.state === "suspended") audioContext.resume().catch(() => {});''','    initAudioFromGesture();')
start=content.index('function armDeadlineTimer() {'); end=content.index('\n}\n\nchrome.runtime.onMessage.addListener',start)+2
content=content[:start]+'''function armDeadlineTimer(){window.clearTimeout(deadlineTimer);window.clearInterval(deadlineRetryTimer);if(!deadlineAt||!scheduleActive||window.top!==window)return;const trigger=()=>chrome.runtime.sendMessage({type:"edgeclose-deadline"}).catch(()=>{});const delay=Math.max(0,deadlineAt-Date.now());deadlineTimer=window.setTimeout(()=>{trigger();let attempts=0;deadlineRetryTimer=window.setInterval(()=>{attempts+=1;if(!scheduleActive||Date.now()+1000<deadlineAt||attempts>8){window.clearInterval(deadlineRetryTimer);return;}trigger();},1000);},delay);}'''+content[end:]
content=content.replace('window.clearTimeout(deadlineTimer);\n    deadlineAt = 0;','window.clearTimeout(deadlineTimer);\n    window.clearInterval(deadlineRetryTimer);\n    deadlineAt = 0;')
Path('content.js').write_text(content)

# Options: preserve full v1.6.2 auth/settings UI, remove backup/release UI and add current Pro pause UI.
html=show('options.html').replace('<script src="backup-lifecycle.js"></script>','').replace('EdgeClose checks published releases for newer versions. Passwords and browsing data are never included.','Microsoft Edge manages updates for extensions installed from the Microsoft Edge Add-ons Store.').replace('<ul id="available-versions" class="version-list" aria-label="Available releases"></ul>','').replace('<button type="button" id="check-updates" class="text-button">Check now</button>','').replace('<script src="options-pro.js"></script>','<script src="options-pro-v165.js"></script>')
Path('options.html').write_text(html)
opts=show('options.js')
start=opts.index('async function checkForUpdates() {'); end=opts.index('\n\ncheckUpdatesButton.addEventListener',start); opts=opts[:start]+"async function checkForUpdates(){if(updateStatus)updateStatus.textContent='Microsoft Edge manages updates for Store-installed extensions.';if(availableVersion)availableVersion.textContent=currentVersion;if(availableVersions)availableVersions.replaceChildren();}"+opts[end:]
opts=opts.replace('checkUpdatesButton.addEventListener("click", checkForUpdates);','checkUpdatesButton?.addEventListener?.("click", checkForUpdates);').replace('async function loadAuditLog() {\n  const entries','async function loadAuditLog() {\n  if(!auditList||!auditEmpty)return;\n  const entries').replace('async function refreshDashboard() {\n  const state','async function refreshDashboard() {\n  if(!policySource||!policyPrecedence||!ruleCount||!monitoredCount||!protectionState||!pauseState)return;\n  const state').replace('function unlockSettings() {\n  authGate.hidden = true;','function unlockSettings() {\n  if(!authGate||!protectedContent)return;\n  authGate.hidden = true;')
Path('options.js').write_text(opts)

pro='''(()=>{const $=s=>document.querySelector(s);const style=document.createElement("style");style.textContent='.ec165-card{margin:0 0 18px;padding:22px;border:1px solid #dbe4e7;border-radius:16px;background:#fff;box-shadow:0 14px 34px rgba(20,47,58,.07)}.ec165-head{display:flex;justify-content:space-between;gap:18px}.ec165-kicker{margin:0 0 6px;color:#1f6feb;font-size:.7rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.ec165-head h2{margin:0;font-size:1.12rem}.ec165-copy{margin:7px 0 16px;color:#66767d;font-size:.82rem;line-height:1.5}.ec165-pill{display:inline-flex;padding:7px 10px;border-radius:999px;background:#eaf8f1;color:#16835b;font-size:.7rem;font-weight:850}.ec165-pill.paused{background:#fff6de;color:#a36a00}.ec165-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.ec165-actions button{padding:11px 8px;border:1px solid #dbe4e7;border-radius:10px;background:#f7fafb;color:#172329;font:800 .78rem Inter,sans-serif;cursor:pointer}.ec165-actions .wide{grid-column:1/-1;background:#eaf8f1;border-color:#c7e8d8;color:#16835b}.ec165-modal{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(13,25,32,.46)}.ec165-dialog{width:min(100%,410px);padding:24px;border:1px solid #dbe4e7;border-radius:16px;background:#fff;box-shadow:0 24px 80px rgba(13,25,32,.25)}.ec165-dialog form{display:grid;gap:10px}.ec165-dialog input{max-width:none}.ec165-dialog-actions{display:flex;justify-content:flex-end;gap:8px}.ec165-status{min-height:18px;color:#b23b36;font-size:.76rem;font-weight:700}@media(max-width:700px){.ec165-actions{grid-template-columns:1fr}.ec165-actions .wide{grid-column:auto}}';document.head.append(style);function ask(type,minutes,label){return new Promise(resolve=>{const m=document.createElement("div");m.className="ec165-modal";m.innerHTML=`<div class="ec165-dialog" role="dialog" aria-modal="true"><h2>Password required</h2><p>${label}</p><form><input id="ec165-password" type="password" autocomplete="current-password" required><div class="ec165-dialog-actions"><button type="button" id="ec165-cancel" class="text-button">Cancel</button><button type="submit" class="primary-button">Confirm</button></div><p id="ec165-error" class="ec165-status"></p></form></div>`;document.body.append(m);const f=m.querySelector("form"),p=m.querySelector("#ec165-password"),e=m.querySelector("#ec165-error");m.querySelector("#ec165-cancel").onclick=()=>{m.remove();resolve(false)};f.onsubmit=async ev=>{ev.preventDefault();const r=await chrome.runtime.sendMessage({type,minutes,password:p.value}).catch(()=>({ok:false}));p.value="";if(!r?.ok){e.textContent="Incorrect password or action unavailable.";p.focus();return;}m.remove();resolve(true)};p.focus();})}function inject(){const root=$("#protected-content");if(!root||$("#ec165-controls"))return;const s=document.createElement("section");s.id="ec165-controls";s.className="ec165-card";s.innerHTML='<div class="ec165-head"><div><p class="ec165-kicker">Protection control</p><h2>Temporary pause</h2><p class="ec165-copy">Pause and resume are available only from this password-protected Options page.</p></div><span id="ec165-pill" class="ec165-pill">Protection ON</span></div><div class="ec165-actions"><button type="button" data-ec165="15">15 minutes</button><button type="button" data-ec165="60">1 hour</button><button type="button" data-ec165="1440">24 hours</button><button type="button" id="ec165-resume" class="wide">Resume protection</button></div>';root.insertBefore(s,root.firstChild);const refresh=async()=>{const st=await chrome.runtime.sendMessage({type:"edgeclose-admin-state"}).catch(()=>null);const pill=$("#ec165-pill");if(pill&&st){pill.textContent=st.paused?"Protection paused":"Protection ON";pill.classList.toggle("paused",!!st.paused);}};s.querySelectorAll("[data-ec165]").forEach(b=>b.onclick=()=>ask("edgeclose-pause",Number(b.dataset.ec165),"Enter your settings password to pause protection.").then(refresh));$("#ec165-resume").onclick=()=>ask("edgeclose-resume",0,"Enter your settings password to resume protection.").then(refresh);refresh()}inject()})();'''
Path('options-pro-v165.js').write_text(pro)

# Update package + validation workflows to current filenames.
for wf in ['.github/workflows/package.yml','.github/workflows/validate.yml']:
 p=Path(wf)
 if p.exists():
  s=p.read_text().replace('background-v164.js','background-v165.js').replace('background-v160.js','background-v165.js').replace('options-pro-v164.js','options-pro-v165.js').replace('options-pro.js','options-pro-v165.js').replace('backup-lifecycle.js','').replace("manifest.background?.service_worker !== 'background-v160.js'","manifest.background?.service_worker !== 'background-v165.js'").replace("const required = ['manifest.json','background-v160.js'","const required = ['manifest.json','background-v165.js'")
  p.write_text(s)

# Remove obsolete runtime sources and stale zips from current branch.
for name in ['background-v160.js','background-v163.js','background-v164.js','options-pro.js','options-pro-v163.js','options-pro-v164.js','backup-lifecycle.js','popup.html','popup.css','popup.js']:
 p=Path(name)
 if p.exists():p.unlink()
for p in Path('.').glob('EdgeClose-*.zip'):p.unlink()
# Clean old one-time workflows.
for p in Path('.github/workflows').glob('*v163*'):p.unlink()
for p in [Path('.github/workflows/rebuild-v165.yml'),Path('.github/workflows/run-rebuild-v165.yml'),Path('.github/workflows/run-clean-v165.yml'),Path('rebuild-v165-clean.sh'),Path('rebuild-v165.sh'),Path('rebuild-v165-final.sh')]:
 if p.exists():p.unlink()
# Changelog entry.
old=show('CHANGELOG.md'); Path('CHANGELOG.md').write_text('## v1.6.5\n\n- Rebuilt from the complete v1.6.2 source baseline; restored the full timer/rule engine.\n- Self-contained background service worker; no cross-version import.\n- Options-only control surface with authenticated pause/resume.\n- Only one audit file is maintained in Downloads: `EdgeClose/audit-log.json`.\n- Removed GitHub version polling; Microsoft Edge manages Store updates.\n- Fixed Options null-reference handling and AudioContext user-gesture policy.\n- Strengthened exact deadline closure with retry handling.\n\n'+old)
PY

node --check background-v165.js
node --check content.js
node --check options.js
node --check options-pro-v165.js
node -e "const fs=require('fs'),m=require('./manifest.json');const v=fs.readFileSync('VERSION','utf8').trim();if(v!=='1.6.5'||m.version!==v)throw Error('version');if(m.background.service_worker!=='background-v165.js')throw Error('worker');if(m.host_permissions.some(x=>x.includes('api.github.com')))throw Error('github');for(const f of ['manifest.json','background-v165.js','content.js','content.css','options.html','options.css','options.js','options-pro-v165.js','managed_schema.json','privacy-policy.html'])if(!fs.existsSync(f))throw Error('missing '+f);for(const f of ['backup-lifecycle.js','popup.js','background-v160.js','background-v163.js','background-v164.js','options-pro.js','options-pro-v164.js'])if(fs.existsSync(f))throw Error('obsolete '+f);const h=fs.readFileSync('options.html','utf8');if(h.includes('backup-lifecycle.js')||h.includes('options-pro.js')||h.includes('popup.js'))throw Error('stale html');const b=fs.readFileSync('background-v165.js','utf8');if(!b.includes('EdgeClose/audit-log.json')||!b.includes('verifyActionPassword'))throw Error('missing audit/auth');if(b.includes('config-audit.enc')||b.includes('encryptedBackup'))throw Error('backup remains');"
