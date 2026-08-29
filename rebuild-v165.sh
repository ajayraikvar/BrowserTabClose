#!/usr/bin/env bash
set -euo pipefail
BASE=v1.6.2

git fetch --tags origin

git show "$BASE:background-v160.js" > background-v160.js
git show "$BASE:content.js" > content.js
git show "$BASE:content.css" > content.css
git show "$BASE:options.html" > options.html
git show "$BASE:options.css" > options.css
git show "$BASE:options.js" > options.js
git show "$BASE:options-pro.js" > options-pro.js
git show "$BASE:managed_schema.json" > managed_schema.json
git show "$BASE:privacy-policy.html" > privacy-policy.html
git show "$BASE:README.md" > README.md

git show "$BASE:manifest.json" > manifest.json
python3 - <<'PY'
import json,re
from pathlib import Path
m=json.loads(Path('manifest.json').read_text())
m['version']='1.6.5'
m['permissions']=['tabs','storage','alarms','downloads']
m['host_permissions']=['<all_urls>']
m['background']={'service_worker':'background-v165.js'}
m['options_page']='options.html'
m['action']={'default_title':'EdgeClose'}
Path('manifest.json').write_text(json.dumps(m,indent=2)+'\n')
Path('VERSION').write_text('1.6.5\n')

bg=Path('background-v160.js').read_text()
bg=bg.replace('const VERSION = "1.6.0";','const VERSION = "1.6.5";')
bg=bg.replace('const PUBLIC_KEY = "edgeclose-backup-public-key";\nconst BACKUP_PATH = "EdgeClose/config-audit.enc";\n','')
bg=re.sub(r'\nasync function publicKey\(\) \{.*?\nlet backupQueue = Promise\.resolve\(\); function queueBackup\(\) \{.*?\n\n','\n',bg,flags=re.S)
audit=r'''
let auditWriteQueue=Promise.resolve();
function auditDataUrl(value){return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(value,null,2))}`;}
async function writeAuditFile(entries){
  auditWriteQueue=auditWriteQueue.then(async()=>{
    try{
      const existing=await chrome.downloads.search({filename:"EdgeClose/audit-log.json"});
      const ids=existing.map((x)=>x.id).filter(Number.isInteger);
      if(ids.length) await chrome.downloads.erase({id:ids[0]}).catch(()=>{});
      await chrome.downloads.download({url:auditDataUrl({schemaVersion:1,version:VERSION,generatedAt:Date.now(),events:entries.slice(0,MAX_AUDIT)}),filename:"EdgeClose/audit-log.json",saveAs:false,conflictAction:"overwrite"});
    }catch{}
  }).catch(()=>{});
  return auditWriteQueue;
}
async function audit(event,metadata={}){
  const blocked=new Set(["password","passwordHash","salt","token","secret","url","pattern","title"]);
  const safe={};
  for(const [k,v] of Object.entries(metadata)) if(!blocked.has(k)&&["string","number","boolean"].includes(typeof v)) safe[k]=v;
  const s=await chrome.storage.local.get(AUDIT_KEY);
  const current=Array.isArray(s[AUDIT_KEY])?s[AUDIT_KEY]:[];
  const next=[{timestamp:Date.now(),event:String(event).slice(0,40),metadata:safe},...current].slice(0,MAX_AUDIT);
  await chrome.storage.local.set({[AUDIT_KEY]:next});
  await writeAuditFile(next);
}
'''
bg=re.sub(r'async function audit\(event, metadata = \{\}\) \{.*?\nasync function closeIfDue',audit+'\nasync function closeIfDue',bg,flags=re.S)
bg=re.sub(r'\s*queueBackup\(\);','',bg)
auth=r'''
const EC_AUTH_HASH="edgeclose-settings-password-hash";
const EC_AUTH_SALT="edgeclose-settings-password-salt";
const EC_AUTH_IT="edgeclose-settings-password-iterations";
async function verifyActionPassword(password){
  try{
    const s=await chrome.storage.local.get([EC_AUTH_HASH,EC_AUTH_SALT,EC_AUTH_IT]);
    if(!s[EC_AUTH_HASH]||!s[EC_AUTH_SALT]) return false;
    const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(password||"")),"PBKDF2",false,["deriveBits"]);
    const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:Uint8Array.from(atob(s[EC_AUTH_SALT]),c=>c.charCodeAt(0)),iterations:Number(s[EC_AUTH_IT])||310000,hash:"SHA-256"},key,256);
    const a=new Uint8Array(bits),e=Uint8Array.from(atob(s[EC_AUTH_HASH]),c=>c.charCodeAt(0));
    if(a.length!==e.length)return false; let d=0; for(let i=0;i<a.length;i++)d|=a[i]^e[i]; return d===0;
  }catch{return false;}
}
'''
bg=bg.replace('\nasync function setPause(minutes)','\n'+auth+'\nasync function setPause(minutes,password)')
bg=bg.replace('async function setPause(minutes) { const n =','async function setPause(minutes,password) { if(!(await verifyActionPassword(password))) return 0; const n =')
bg=bg.replace('async function resume() { await chrome.storage.local.remove(PAUSE_KEY);','async function resume(password) { if(!(await verifyActionPassword(password))) return false; await chrome.storage.local.remove(PAUSE_KEY);')
bg=bg.replace('setPause(message.minutes).then','setPause(message.minutes,message.password).then')
bg=bg.replace('resume().then','resume(message.password).then')
bg=bg.replace('if (message.type === "edgeclose-backup-now") { encryptedBackup().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false })); return true; }','')
Path('background-v165.js').write_text(bg)

content=Path('content.js').read_text()
if 'function initAudioFromGesture' not in content:
  content=content.replace('let audioContext;','let audioContext;\nlet deadlineRetryTimer;')
  content=content.replace('''function playWarningSound() {
  try {
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === "suspended") audioContext.resume();''','''function initAudioFromGesture(){
  if(!soundEnabled||audioContext)return;
  try{audioContext=new AudioContext(); if(audioContext.state==="suspended")audioContext.resume().catch(()=>{});}catch{audioContext=null;}
}
function playWarningSound(){
  try{
    if(!audioContext||audioContext.state!=="running")return;''')
  content=content.replace('''    if (soundEnabled && !audioContext) {
      try { audioContext = new AudioContext(); } catch { audioContext = null; }
    }
    if (soundEnabled && audioContext?.state === "suspended") audioContext.resume().catch(() => {});''','    initAudioFromGesture();')
content=re.sub(r'function armDeadlineTimer\(\) \{.*?\n\}', '''function armDeadlineTimer(){
  window.clearTimeout(deadlineTimer); window.clearInterval(deadlineRetryTimer);
  if(!deadlineAt||!scheduleActive||window.top!==window)return;
  const trigger=()=>chrome.runtime.sendMessage({type:"edgeclose-deadline"}).catch(()=>{});
  const delay=Math.max(0,deadlineAt-Date.now());
  deadlineTimer=window.setTimeout(()=>{
    trigger(); let attempts=0;
    deadlineRetryTimer=window.setInterval(()=>{
      attempts+=1;
      if(!scheduleActive||Date.now()+1000<deadlineAt||attempts>8){window.clearInterval(deadlineRetryTimer);return;}
      trigger();
    },1000);
  },delay);
}''',content,count=1,flags=re.S)
content=content.replace('window.clearTimeout(deadlineTimer);\n    deadlineAt = 0;','window.clearTimeout(deadlineTimer);\n    window.clearInterval(deadlineRetryTimer);\n    deadlineAt = 0;')
Path('content.js').write_text(content)

html=Path('options.html').read_text()
html=html.replace('<script src="backup-lifecycle.js"></script>','')
html=html.replace('EdgeClose checks published releases for newer versions. Passwords and browsing data are never included.','Microsoft Edge manages updates for extensions installed from the Microsoft Edge Add-ons Store.')
html=html.replace('<ul id="available-versions" class="version-list" aria-label="Available releases"></ul>','')
html=html.replace('<button type="button" id="check-updates" class="text-button">Check now</button>','')
html=html.replace('<script src="options-pro.js"></script>','<script src="options-pro-v165.js"></script>')
Path('options.html').write_text(html)

opts=Path('options.js').read_text()
start=opts.find('async function checkForUpdates() {'); end=opts.find('\n\ncheckUpdatesButton.addEventListener',start)
if start>=0:
  if end<0:end=len(opts)
  opts=opts[:start]+"async function checkForUpdates(){ if(updateStatus)updateStatus.textContent='Microsoft Edge manages updates for Store-installed extensions.'; if(availableVersion)availableVersion.textContent=currentVersion; if(availableVersions)availableVersions.replaceChildren(); }"+opts[end:]
opts=opts.replace('checkUpdatesButton.addEventListener("click", checkForUpdates);','checkUpdatesButton?.addEventListener?.("click", checkForUpdates);')
opts=opts.replace('async function loadAuditLog() {\n  const entries','async function loadAuditLog() {\n  if(!auditList||!auditEmpty)return;\n  const entries')
opts=opts.replace('async function refreshDashboard() {\n  const state','async function refreshDashboard() {\n  if(!policySource||!policyPrecedence||!ruleCount||!monitoredCount||!protectionState||!pauseState)return;\n  const state')
opts=opts.replace('function unlockSettings() {\n  authGate.hidden = true;','function unlockSettings() {\n  if(!authGate||!protectedContent)return;\n  authGate.hidden = true;')
Path('options.js').write_text(opts)

# New complete pause UI, independent of old Pro helper implementation.
pro=r'''(()=>{
 const $=s=>document.querySelector(s);
 const ask=(type,minutes,label)=>new Promise(resolve=>{
  const modal=document.createElement('div');modal.className='ec160-modal';modal.innerHTML=`<div class="ec160-dialog" role="dialog" aria-modal="true"><h2>Password required</h2><p>${label}</p><form id="ec165-auth"><input id="ec165-pass" type="password" autocomplete="current-password" required><div class="ec160-dialog-actions"><button type="button" id="ec165-cancel" class="text-button">Cancel</button><button type="submit" class="primary-button">Confirm</button></div><p id="ec165-error" class="ec160-status"></p></form></div>`;document.body.append(modal);
  const form=$('#ec165-auth'),pass=$('#ec165-pass'),err=$('#ec165-error');
  $('#ec165-cancel').onclick=()=>{modal.remove();resolve(false)};
  form.onsubmit=async e=>{e.preventDefault();const p=pass.value;const r=await chrome.runtime.sendMessage({type,password:p,minutes}).catch(()=>({ok:false}));pass.value='';if(!r?.ok){err.textContent='Incorrect password or action unavailable.';pass.focus();return;}modal.remove();resolve(true)};pass.focus();
 });
 function inject(){const root=$('#protected-content');if(!root||$('#ec165-controls'))return;const sec=document.createElement('section');sec.id='ec165-controls';sec.className='ec160-card';sec.innerHTML='<div class="ec160-head"><div><p class="ec160-kicker">Protection control</p><h2>Temporary pause</h2><p class="ec160-copy">Pause and resume are available only from this password-protected Options page.</p></div><span id="ec165-pill" class="ec160-pill">Protection ON</span></div><div class="ec160-actions"><button type="button" data-ec165="15">15 minutes</button><button type="button" data-ec165="60">1 hour</button><button type="button" data-ec165="1440">24 hours</button><button type="button" id="ec165-resume" class="wide">Resume protection</button></div>';root.insertBefore(sec,root.firstChild);
  const refresh=async()=>{const s=await chrome.runtime.sendMessage({type:'edgeclose-admin-state'}).catch(()=>null);const pill=$('#ec165-pill');if(pill&&s)pill.textContent=s.paused?'Protection paused':'Protection ON';};
  sec.querySelectorAll('[data-ec165]').forEach(b=>b.onclick=()=>ask('edgeclose-pause',Number(b.dataset.ec165),'Enter your settings password to pause protection.').then(refresh));
  $('#ec165-resume').onclick=()=>ask('edgeclose-resume',0,'Enter your settings password to resume protection.').then(refresh);refresh();
 }
 inject();
})();
'''
# Keep Pro styling/design but replace its runtime behavior with authenticated pause controls.
Path('options-pro-v165.js').write_text(pro)

# Delete obsolete source files/artifacts.
for name in ['background-v160.js','background-v163.js','background-v164.js','options-pro.js','options-pro-v163.js','options-pro-v164.js','backup-lifecycle.js','popup.html','popup.css','popup.js']:
 p=Path(name)
 if p.exists():p.unlink()
for p in Path('.').glob('EdgeClose-*.zip'): p.unlink()

pp=Path('privacy-policy.html').read_text()
pp=re.sub(r'(?is)<h2>Encrypted backup</h2>.*?<h2>Audit log</h2>','<h2>Local audit log</h2><p>EdgeClose keeps a bounded management audit log locally and maintains one up-to-date copy as <code>Downloads/EdgeClose/audit-log.json</code>. Configuration and recovery backups are not downloaded automatically.</p><p>The audit file contains management events only and does not record passwords, website URLs, page titles, page contents, or rule patterns.</p><h2>Audit log</h2>',pp)
pp=re.sub(r'(?is)The Options page may request public release metadata.*?request\\.','EdgeClose does not contact GitHub or another remote update service to check extension versions. Microsoft Edge manages updates for Store-installed extensions.',pp)
Path('privacy-policy.html').write_text(pp)

ch=git_file('CHANGELOG.md')
entry='''## v1.6.5\n\n- Rebuilt from the complete v1.6.2 source baseline so no runtime/UI code is silently lost.\n- Use a self-contained v1.6.5 service worker with no cross-version dependency.\n- Keep Options as the single control surface and authenticate pause/resume.\n- Maintain only one audit log at `Downloads/EdgeClose/audit-log.json`; no automatic configuration/recovery downloads.\n- Remove GitHub version polling; Microsoft Edge manages Store updates.\n- Fix Options null-reference startup and AudioContext gesture handling.\n- Strengthen exact deadline closure with retry handling.\n\n'''
if not ch.startswith('## v1.6.5'):Path('CHANGELOG.md').write_text(entry+ch)

# Keep only the current rebuild workflow out of the final tree.
Path('rebuild-v165.sh').unlink(missing_ok=True)
PY

node --check background-v165.js
node --check content.js
node --check options.js
node --check options-pro-v165.js
node -e "const fs=require('fs'),m=require('./manifest.json'); const v=fs.readFileSync('VERSION','utf8').trim(); if(v!=='1.6.5'||m.version!==v||m.background.service_worker!=='background-v165.js')process.exit(1); if(m.host_permissions.some(x=>x.includes('api.github.com')))process.exit(1); for(const f of ['manifest.json','background-v165.js','content.js','content.css','options.html','options.css','options.js','options-pro-v165.js','managed_schema.json','privacy-policy.html']) if(!fs.existsSync(f))process.exit(1); if(fs.existsSync('backup-lifecycle.js')||fs.existsSync('popup.js')||fs.existsSync('background-v163.js'))process.exit(1);"
