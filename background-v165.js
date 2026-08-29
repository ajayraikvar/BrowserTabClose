const VERSION = "1.6.5";
const DEFAULT_TIMEOUT = 900;
const DEFAULT_WARNING = 10;
const MAX_AUDIT = 200;
const CHECK_ALARM = "edgeclose-check";
const PAUSE_ALARM = "edgeclose-pause-expiry";
const WARNING_PREFIX = "edgeclose-warning-";
const CLOSE_PREFIX = "edgeclose-close-";
const ACTIVITY_PREFIX = "edgeclose-last-activity-";
const INHERITED_PREFIX = "edgeclose-inherited-site-";
const PAUSE_KEY = "edgeclose-pause-until";
const AUDIT_KEY = "edgeclose-audit-log";

const base64 = (bytes) => { let s = ""; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const jsonDataUrl = (value) => `data:application/octet-stream;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(value))))}`;

function normalizeTime(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? String(value) : ""; }
function normalizeTimeout(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(15, Math.min(86400, Math.round(n))) : DEFAULT_TIMEOUT; }
function normalizeWarning(value, timeout) { const n = Number(value); return Number.isFinite(n) ? Math.max(1, Math.min(timeout - 1, Math.round(n))) : Math.min(DEFAULT_WARNING, timeout - 1); }
function normalizeSite(site) { const timeout = normalizeTimeout(site?.timeoutSeconds); return { pattern: String(site?.pattern || "").trim(), timeoutSeconds: timeout, warningSeconds: normalizeWarning(site?.warningSeconds, timeout), fromTime: normalizeTime(site?.fromTime), toTime: normalizeTime(site?.toTime), soundEnabled: site?.soundEnabled !== false }; }
function normalizeSites(sites, legacy = []) { const source = Array.isArray(sites) && sites.length ? sites : (Array.isArray(legacy) ? legacy.map((pattern) => ({ pattern })) : []); return source.map(normalizeSite).filter((site) => site.pattern).slice(0, 100); }
function isWithinSchedule(site, date = new Date()) { if (!site.fromTime || !site.toTime) return true; const now = date.getHours() * 60 + date.getMinutes(); const [fh, fm] = site.fromTime.split(":").map(Number); const [th, tm] = site.toTime.split(":").map(Number); const from = fh * 60 + fm, to = th * 60 + tm; if (from === to) return true; return from < to ? now >= from && now < to : now >= from || now < to; }
function scheduleStart(site, date = new Date()) { if (!site.fromTime || !site.toTime) return 0; const [h, m] = site.fromTime.split(":").map(Number); const start = new Date(date); start.setHours(h, m, 0, 0); if (start > date && site.fromTime > site.toTime) start.setDate(start.getDate() - 1); return start.getTime(); }
function matches(pattern, url) { if (!pattern || !url) return false; if (!pattern.includes("://")) { try { const host = new URL(url).hostname.replace(/^www\./i, ""); const domain = pattern.trim().replace(/^\*\.?/, "").replace(/^www\./i, ""); const escaped = domain.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"); return new RegExp(`(^|\\.)${escaped}$`, "i").test(host); } catch { return false; } } const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&"); return new RegExp(`^${escaped.replace(/\*/g, ".*")}\\/?$`, "i").test(url); }
function priority(pattern) { const v = pattern.trim(); const wc = (v.match(/\*/g) || []).length; let score = v.includes("://") ? 400000 : 200000; if (!wc) score += 50000; if (v.includes("/")) score += 3000; score += Math.min(1000, v.replace(/\*/g, "").length) * 10; return score - wc * 500; }

async function settings() { const managed = await chrome.storage.managed.get({ sites: undefined }).catch(() => ({})); const local = await chrome.storage.local.get({ sites: [], patterns: [] }); const managedPresent = Array.isArray(managed.sites); return { sites: normalizeSites(managedPresent ? managed.sites : local.sites, managedPresent ? [] : local.patterns), managed: managedPresent }; }
async function pausedUntil() { const s = await chrome.storage.local.get(PAUSE_KEY); const n = Number(s[PAUSE_KEY]) || 0; if (n > Date.now()) return n; if (n) await chrome.storage.local.remove(PAUSE_KEY); return 0; }
async function isPaused() { return (await pausedUntil()) > Date.now(); }
async function siteForTab(tab) { if (await isPaused()) return null; const cfg = await settings(); const matchesList = cfg.sites.map((site, index) => ({ site, index, score: priority(site.pattern) })).filter((x) => matches(x.site.pattern, tab.url) && isWithinSchedule(x.site)).sort((a, b) => b.score - a.score || a.index - b.index); if (matchesList.length) return matchesList[0].site; if (Number.isInteger(tab.id)) { const k = `${INHERITED_PREFIX}${tab.id}`; const s = await chrome.storage.session.get(k); if (s[k] && isWithinSchedule(s[k])) return normalizeSite(s[k]); } return null; }
function activityKey(id) { return `${ACTIVITY_PREFIX}${id}`; }
function warningName(id) { return `${WARNING_PREFIX}${id}`; }
function closeName(id) { return `${CLOSE_PREFIX}${id}`; }
async function lastActivity(id) { const k = activityKey(id); const s = await chrome.storage.session.get(k); const n = Number(s[k]); if (n > 0) return n; const now = Date.now(); await chrome.storage.session.set({ [k]: now }); return now; }
async function clearTabAlarms(id) { await chrome.alarms.clear(warningName(id)); await chrome.alarms.clear(closeName(id)); }
async function schedule(id, activity, site) { await clearTabAlarms(id); if (await isPaused() || !isWithinSchedule(site)) return; const effective = Math.max(activity, scheduleStart(site)); const elapsed = (Date.now() - effective) / 1000; if (site.timeoutSeconds - site.warningSeconds - elapsed > 0) chrome.alarms.create(warningName(id), { delayInMinutes: (site.timeoutSeconds - site.warningSeconds - elapsed) / 60 }); if (site.timeoutSeconds - elapsed > 0) chrome.alarms.create(closeName(id), { delayInMinutes: (site.timeoutSeconds - elapsed) / 60 }); }
async function reschedule() { if (await isPaused()) { await chrome.alarms.getAll().then((all) => Promise.all(all.filter((a) => a.name.startsWith(WARNING_PREFIX) || a.name.startsWith(CLOSE_PREFIX)).map((a) => chrome.alarms.clear(a.name)))); return; } const tabs = await chrome.tabs.query({}); await Promise.all(tabs.map(async (tab) => { if (!Number.isInteger(tab.id)) return; const site = tab.url && await siteForTab(tab); if (!site) return clearTabAlarms(tab.id); await schedule(tab.id, await lastActivity(tab.id), site); })); }
async function statusBroadcast() { const tabs = await chrome.tabs.query({}); const active = new Set((await chrome.tabs.query({ active: true })).map((t) => t.id)); const paused = await isPaused(); await Promise.all(tabs.map(async (tab) => { if (!Number.isInteger(tab.id)) return; const site = !paused && tab.url && await siteForTab(tab); if (!site) { chrome.tabs.sendMessage(tab.id, { type: "edgeclose-status", enabled: false, paused }).catch(() => {}); return; } const activity = await lastActivity(tab.id); const deadline = Math.max(activity, scheduleStart(site)) + site.timeoutSeconds * 1000; const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); chrome.tabs.sendMessage(tab.id, { type: "edgeclose-status", scheduleActive: true, timeoutSeconds: site.timeoutSeconds, warningSeconds: site.warningSeconds, soundEnabled: site.soundEnabled, idleState: remaining <= site.warningSeconds && remaining > 0 ? "warning" : "active", remainingSeconds: remaining, deadlineAt: deadline, isActiveTab: active.has(tab.id), paused: false }).catch(() => {}); })); }
async function closeIfDue(id) { if (await isPaused()) return; const tab = await chrome.tabs.get(id).catch(() => null); const site = tab && await siteForTab(tab); if (!tab || !site || !isWithinSchedule(site)) return; const activity = await lastActivity(id); const deadline = Math.max(activity, scheduleStart(site)) + site.timeoutSeconds * 1000; if (Date.now() >= deadline) { await chrome.tabs.remove(id); await audit("tab_closed", {}); } else await schedule(id, activity, site); }

async function audit(event, metadata = {}) {
  const blocked = new Set(["password","passwordHash","salt","token","secret","url","pattern","title"]);
  const safe = {};
  for (const [key,value] of Object.entries(metadata || {})) if (!blocked.has(key) && ["string","number","boolean"].includes(typeof value)) safe[key]=value;
  const stored = await chrome.storage.local.get(AUDIT_KEY);
  const current = Array.isArray(stored[AUDIT_KEY]) ? stored[AUDIT_KEY] : [];
  const next = [{timestamp:Date.now(),event:String(event).slice(0,40),metadata:safe},...current].slice(0,MAX_AUDIT);
  await chrome.storage.local.set({[AUDIT_KEY]:next});
  if (!audit.writeQueue) audit.writeQueue=Promise.resolve();
  audit.writeQueue=audit.writeQueue.then(async()=>{
    try {
      const found=await chrome.downloads.search({filename:"EdgeClose/audit-log.json"});
      for (const item of found.slice(0,1)) if (Number.isInteger(item.id)) await chrome.downloads.erase({id:item.id}).catch(()=>{});
      await chrome.downloads.download({url:`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({schemaVersion:1,version:VERSION,generatedAt:Date.now(),events:next},null,2))}`,filename:"EdgeClose/audit-log.json",saveAs:false,conflictAction:"overwrite"});
    } catch {}
  }).catch(()=>{});
}
chrome.runtime.onInstalled.addListener((details) => { if (details.reason === "install") { audit("extension_installed", {}); chrome.runtime.openOptionsPage(); } else if (details.reason === "update") audit("extension_updated", {}); configure(); reschedule(); statusBroadcast(); });
chrome.runtime.onStartup.addListener(() => { configure(); reschedule(); statusBroadcast();  });
function configure() { chrome.alarms.clear(CHECK_ALARM); chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 0.5 }); }
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.tabs.onActivated.addListener(() => statusBroadcast());
chrome.tabs.onCreated.addListener(async (tab) => { if (!Number.isInteger(tab.id) || !Number.isInteger(tab.openerTabId) || await isPaused()) return; const opener = await chrome.tabs.get(tab.openerTabId).catch(() => null); const site = opener && await siteForTab(opener); if (site) { await chrome.storage.session.set({ [`${INHERITED_PREFIX}${tab.id}`]: site }); await markActive(tab.id); } });
async function markActive(id) { if (await isPaused()) return; const now = Date.now(); await chrome.storage.session.set({ [activityKey(id)]: now }); const tab = await chrome.tabs.get(id).catch(() => null); const site = tab && await siteForTab(tab); if (site) await schedule(id, now, site); await statusBroadcast(); }
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === "complete") { markActive(id); statusBroadcast(); } });
chrome.tabs.onRemoved.addListener(async (id) => { await chrome.storage.session.remove([activityKey(id), `${INHERITED_PREFIX}${id}`]); await clearTabAlarms(id); });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => { if (message.type === "edgeclose-activity" && Number.isInteger(sender.tab?.id)) { markActive(sender.tab.id); return; } if (message.type === "edgeclose-deadline" && Number.isInteger(sender.tab?.id)) { closeIfDue(sender.tab.id); return; } if (message.type === "edgeclose-pause") { setPause(message.minutes,message.password).then((until) => sendResponse({ ok: true, pauseUntil: until })).catch(() => sendResponse({ ok: false })); return true; } if (message.type === "edgeclose-resume") { resume(message.password).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false })); return true; } if (message.type === "edgeclose-admin-state") { adminState().then(sendResponse).catch(() => sendResponse(null)); return true; } if (message.type === "edgeclose-audit-log") { chrome.storage.local.get(AUDIT_KEY).then((s) => sendResponse(Array.isArray(s[AUDIT_KEY]) ? s[AUDIT_KEY].slice(0, MAX_AUDIT) : [])).catch(() => sendResponse([])); return true; } if (message.type === "edgeclose-audit") { audit(message.event, message.metadata || {}).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false })); return true; }  });
const AUTH_HASH_KEY="edgeclose-settings-password-hash";
const AUTH_SALT_KEY="edgeclose-settings-password-salt";
const AUTH_ITERATIONS_KEY="edgeclose-settings-password-iterations";
async function verifyActionPassword(password){try{const s=await chrome.storage.local.get([AUTH_HASH_KEY,AUTH_SALT_KEY,AUTH_ITERATIONS_KEY]);if(!s[AUTH_HASH_KEY]||!s[AUTH_SALT_KEY])return false;const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(password||"")),"PBKDF2",false,["deriveBits"]);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:Uint8Array.from(atob(s[AUTH_SALT_KEY]),c=>c.charCodeAt(0)),iterations:Number(s[AUTH_ITERATIONS_KEY])||310000,hash:"SHA-256"},key,256);const a=new Uint8Array(bits),e=Uint8Array.from(atob(s[AUTH_HASH_KEY]),c=>c.charCodeAt(0));if(a.length!==e.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^e[i];return d===0;}catch{return false;}}
async function setPause(minutes,password){if(!(await verifyActionPassword(password)))return 0;const n=Math.max(1,Math.min(1440,Math.round(Number(minutes)||15)));const until=Date.now()+n*60000;await chrome.storage.local.set({[PAUSE_KEY]:until});await clearTabAlarmsAll();await statusBroadcast();await audit("pause_set",{durationMinutes:n});return until;}
async function resume(password){if(!(await verifyActionPassword(password)))return false;await chrome.storage.local.remove(PAUSE_KEY);await chrome.alarms.clear(PAUSE_ALARM);await reschedule();await statusBroadcast();await audit("pause_cleared",{});return true;}
async function clearTabAlarmsAll() { const all = await chrome.alarms.getAll(); await Promise.all(all.filter((a) => a.name.startsWith(WARNING_PREFIX) || a.name.startsWith(CLOSE_PREFIX)).map((a) => chrome.alarms.clear(a.name))); }
async function adminState() { const cfg = await settings(); return { managed: cfg.managed, source: cfg.managed ? "Managed policy" : "Local settings", precedence: "Managed policy > local settings", ruleCount: cfg.sites.length, monitoredCount: (await monitoredCount()), paused: await isPaused(), auditCount: (await chrome.storage.local.get(AUDIT_KEY))[AUDIT_KEY]?.length || 0 }; }
async function monitoredCount() { if (await isPaused()) return 0; const tabs = await chrome.tabs.query({}); let count = 0; for (const tab of tabs) if (Number.isInteger(tab.id) && await siteForTab(tab)) count += 1; return count; }
chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local"&&(changes.sites||changes.patterns||changes[PAUSE_KEY]||changes[AUTH_HASH_KEY])){reschedule();statusBroadcast();}if(area==="managed"&&changes.sites){reschedule();statusBroadcast();}});
chrome.alarms.onAlarm.addListener(async (alarm) => { if (alarm.name === PAUSE_ALARM) { await resume(); return; } if (alarm.name.startsWith(WARNING_PREFIX)) { await statusBroadcast(); return; } if (alarm.name.startsWith(CLOSE_PREFIX)) { const id = Number(alarm.name.slice(CLOSE_PREFIX.length)); if (Number.isInteger(id)) await closeIfDue(id); return; } if (alarm.name === CHECK_ALARM) { await reschedule(); await statusBroadcast(); } });
configure();
reschedule();
statusBroadcast();