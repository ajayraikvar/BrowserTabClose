const VERSION = "1.6.6";
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
const AUTH_HASH_KEY = "edgeclose-settings-password-hash";
const AUTH_SALT_KEY = "edgeclose-settings-password-salt";
const AUTH_ITERATIONS_KEY = "edgeclose-settings-password-iterations";

function normalizeTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? String(value) : "";
}
function normalizeTimeout(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(15, Math.min(86400, Math.round(n))) : DEFAULT_TIMEOUT;
}
function normalizeWarning(value, timeout) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(timeout - 1, Math.round(n))) : Math.min(DEFAULT_WARNING, timeout - 1);
}
function normalizeSite(site) {
  const timeoutSeconds = normalizeTimeout(site?.timeoutSeconds);
  return {
    pattern: String(site?.pattern || "").trim(),
    timeoutSeconds,
    warningSeconds: normalizeWarning(site?.warningSeconds, timeoutSeconds),
    fromTime: normalizeTime(site?.fromTime),
    toTime: normalizeTime(site?.toTime),
    soundEnabled: site?.soundEnabled !== false
  };
}
function normalizeSites(sites, legacy = []) {
  const source = Array.isArray(sites) && sites.length ? sites : (Array.isArray(legacy) ? legacy.map((pattern) => ({ pattern })) : []);
  return source.map(normalizeSite).filter((site) => site.pattern).slice(0, 100);
}
function isWithinSchedule(site, date = new Date()) {
  if (!site.fromTime || !site.toTime) return true;
  const now = date.getHours() * 60 + date.getMinutes();
  const [fh, fm] = site.fromTime.split(":").map(Number);
  const [th, tm] = site.toTime.split(":").map(Number);
  const from = fh * 60 + fm;
  const to = th * 60 + tm;
  if (from === to) return true;
  return from < to ? now >= from && now < to : now >= from || now < to;
}
function scheduleStart(site, date = new Date()) {
  if (!site.fromTime || !site.toTime) return 0;
  const [h, m] = site.fromTime.split(":").map(Number);
  const start = new Date(date);
  start.setHours(h, m, 0, 0);
  if (start > date && site.fromTime > site.toTime) start.setDate(start.getDate() - 1);
  return start.getTime();
}
function matches(pattern, url) {
  if (!pattern || !url) return false;
  try {
    if (!pattern.includes("://")) {
      const host = new URL(url).hostname.replace(/^www\./i, "");
      const domain = pattern.trim().replace(/^\*\.?/, "").replace(/^www\./i, "");
      const escaped = domain.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`(^|\\.)${escaped}$`, "i").test(host);
    }
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}\\/?$`, "i").test(url);
  } catch {
    return false;
  }
}
function priority(pattern) {
  const value = pattern.trim();
  const wildcards = (value.match(/\*/g) || []).length;
  let score = value.includes("://") ? 400000 : 200000;
  if (!wildcards) score += 50000;
  if (value.includes("/")) score += 3000;
  score += Math.min(1000, value.replace(/\*/g, "").length) * 10;
  return score - wildcards * 500;
}
async function getSettings() {
  const managed = await chrome.storage.managed.get({ sites: undefined }).catch(() => ({}));
  const local = await chrome.storage.local.get({ sites: [], patterns: [] });
  const managedPresent = Array.isArray(managed.sites);
  return {
    sites: normalizeSites(managedPresent ? managed.sites : local.sites, managedPresent ? [] : local.patterns),
    managed: managedPresent
  };
}
async function getPauseUntil() {
  const stored = await chrome.storage.local.get(PAUSE_KEY);
  const until = Number(stored[PAUSE_KEY]) || 0;
  if (until > Date.now()) return until;
  if (until) await chrome.storage.local.remove(PAUSE_KEY);
  return 0;
}
async function isPaused() {
  return (await getPauseUntil()) > Date.now();
}
const activityKey = (id) => `${ACTIVITY_PREFIX}${id}`;
const warningName = (id) => `${WARNING_PREFIX}${id}`;
const closeName = (id) => `${CLOSE_PREFIX}${id}`;
const inheritedKey = (id) => `${INHERITED_PREFIX}${id}`;

async function siteForTab(tab) {
  if (await isPaused()) return null;
  const config = await getSettings();
  const candidates = config.sites
    .map((site, index) => ({ site, index, score: priority(site.pattern) }))
    .filter((entry) => matches(entry.site.pattern, tab?.url) && isWithinSchedule(entry.site))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (candidates.length) return candidates[0].site;
  if (Number.isInteger(tab?.id)) {
    const stored = await chrome.storage.session.get(inheritedKey(tab.id));
    if (stored[inheritedKey(tab.id)] && isWithinSchedule(stored[inheritedKey(tab.id)])) return normalizeSite(stored[inheritedKey(tab.id)]);
  }
  return null;
}
async function lastActivity(id) {
  const key = activityKey(id);
  const stored = await chrome.storage.session.get(key);
  const timestamp = Number(stored[key]);
  if (timestamp > 0) return timestamp;
  const now = Date.now();
  await chrome.storage.session.set({ [key]: now });
  return now;
}
async function clearTabAlarms(id) {
  await chrome.alarms.clear(warningName(id));
  await chrome.alarms.clear(closeName(id));
}
async function clearAllTabAlarms() {
  const alarms = await chrome.alarms.getAll();
  await Promise.all(alarms.filter((alarm) => alarm.name.startsWith(WARNING_PREFIX) || alarm.name.startsWith(CLOSE_PREFIX)).map((alarm) => chrome.alarms.clear(alarm.name)));
}
async function scheduleTab(id, activity, site) {
  await clearTabAlarms(id);
  if (await isPaused() || !isWithinSchedule(site)) return;
  const effectiveStart = Math.max(activity, scheduleStart(site));
  const elapsed = (Date.now() - effectiveStart) / 1000;
  const warningDelay = site.timeoutSeconds - site.warningSeconds - elapsed;
  const closeDelay = site.timeoutSeconds - elapsed;
  if (warningDelay > 0) await chrome.alarms.create(warningName(id), { delayInMinutes: warningDelay / 60 });
  if (closeDelay > 0) await chrome.alarms.create(closeName(id), { delayInMinutes: closeDelay / 60 });
}
async function reschedule() {
  if (await isPaused()) {
    await clearAllTabAlarms();
    return;
  }
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id)) return;
    const site = await siteForTab(tab);
    if (!site) {
      await clearTabAlarms(tab.id);
      return;
    }
    await scheduleTab(tab.id, await lastActivity(tab.id), site);
  }));
}
async function broadcastStatus() {
  const tabs = await chrome.tabs.query({});
  const activeIds = new Set((await chrome.tabs.query({ active: true })).map((tab) => tab.id));
  const paused = await isPaused();
  await Promise.all(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id)) return;
    const site = !paused ? await siteForTab(tab) : null;
    if (!site) {
      chrome.tabs.sendMessage(tab.id, { type: "edgeclose-status", enabled: false, paused }).catch(() => {});
      return;
    }
    const activity = await lastActivity(tab.id);
    const deadline = Math.max(activity, scheduleStart(site)) + site.timeoutSeconds * 1000;
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    chrome.tabs.sendMessage(tab.id, {
      type: "edgeclose-status",
      scheduleActive: true,
      timeoutSeconds: site.timeoutSeconds,
      warningSeconds: site.warningSeconds,
      soundEnabled: site.soundEnabled,
      idleState: remaining <= site.warningSeconds && remaining > 0 ? "warning" : "active",
      remainingSeconds: remaining,
      deadlineAt: deadline,
      isActiveTab: activeIds.has(tab.id),
      paused: false
    }).catch(() => {});
  }));
}
async function closeIfDue(id) {
  if (await isPaused()) return;
  const tab = await chrome.tabs.get(id).catch(() => null);
  if (!tab) return;
  const site = await siteForTab(tab);
  if (!site || !isWithinSchedule(site)) return;
  const activity = await lastActivity(id);
  const deadline = Math.max(activity, scheduleStart(site)) + site.timeoutSeconds * 1000;
  if (Date.now() >= deadline) {
    await chrome.tabs.remove(id).catch(() => {});
    await writeAudit("tab_closed", {});
  } else {
    await scheduleTab(id, activity, site);
  }
}
function safeMetadata(metadata) {
  const blocked = new Set(["password", "passwordHash", "salt", "token", "secret", "url", "pattern", "title"]);
  const output = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (!blocked.has(key) && ["string", "number", "boolean"].includes(typeof value)) output[key] = value;
  }
  return output;
}
let auditQueue = Promise.resolve();
async function writeAuditFile(entries) {
  auditQueue = auditQueue.then(async () => {
    try {
      const existing = await chrome.downloads.search({ filename: "EdgeClose/audit-log.json" });
      for (const item of existing) {
        if (Number.isInteger(item.id)) await chrome.downloads.erase({ id: item.id }).catch(() => {});
      }
      const payload = { schemaVersion: 1, version: VERSION, generatedAt: Date.now(), events: entries.slice(0, MAX_AUDIT) };
      await chrome.downloads.download({
        url: `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`,
        filename: "EdgeClose/audit-log.json",
        saveAs: false,
        conflictAction: "overwrite"
      });
    } catch {}
  }).catch(() => {});
  return auditQueue;
}
async function writeAudit(event, metadata = {}) {
  const stored = await chrome.storage.local.get(AUDIT_KEY);
  const current = Array.isArray(stored[AUDIT_KEY]) ? stored[AUDIT_KEY] : [];
  const next = [{ timestamp: Date.now(), event: String(event).slice(0, 40), metadata: safeMetadata(metadata) }, ...current].slice(0, MAX_AUDIT);
  await chrome.storage.local.set({ [AUDIT_KEY]: next });
  await writeAuditFile(next);
}
async function verifyActionPassword(password) {
  try {
    const stored = await chrome.storage.local.get([AUTH_HASH_KEY, AUTH_SALT_KEY, AUTH_ITERATIONS_KEY]);
    if (!stored[AUTH_HASH_KEY] || !stored[AUTH_SALT_KEY]) return false;
    const rawKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password || "")), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({
      name: "PBKDF2",
      salt: Uint8Array.from(atob(stored[AUTH_SALT_KEY]), (c) => c.charCodeAt(0)),
      iterations: Number(stored[AUTH_ITERATIONS_KEY]) || 310000,
      hash: "SHA-256"
    }, rawKey, 256);
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
async function setPause(minutes, password) {
  if (!(await verifyActionPassword(password))) return 0;
  const duration = Math.max(1, Math.min(1440, Math.round(Number(minutes) || 15)));
  const until = Date.now() + duration * 60000;
  await chrome.storage.local.set({ [PAUSE_KEY]: until });
  await chrome.alarms.create(PAUSE_ALARM, { when: until });
  await clearAllTabAlarms();
  await writeAudit("pause_set", { durationMinutes: duration });
  await broadcastStatus();
  return until;
}
async function resumeInternal() {
  await chrome.storage.local.remove(PAUSE_KEY);
  await chrome.alarms.clear(PAUSE_ALARM);
  await reschedule();
  await broadcastStatus();
}
async function resume(password) {
  if (!(await verifyActionPassword(password))) return false;
  await resumeInternal();
  await writeAudit("pause_cleared", {});
  return true;
}
async function adminState() {
  const cfg = await getSettings();
  const tabs = await chrome.tabs.query({});
  const paused = await isPaused();
  let monitoredCount = 0;
  if (!paused) {
    for (const tab of tabs) {
      if (Number.isInteger(tab.id) && await siteForTab(tab)) monitoredCount += 1;
    }
  }
  const stored = await chrome.storage.local.get(AUDIT_KEY);
  return {
    managed: cfg.managed,
    source: cfg.managed ? "Managed policy" : "Local settings",
    precedence: "Managed policy > local settings",
    ruleCount: cfg.sites.length,
    monitoredCount,
    paused,
    auditCount: Array.isArray(stored[AUDIT_KEY]) ? stored[AUDIT_KEY].length : 0
  };
}
function configure() {
  chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await writeAudit("extension_installed", {});
    await chrome.runtime.openOptionsPage();
  } else if (details.reason === "update") {
    await writeAudit("extension_updated", {});
  }
  configure();
  await reschedule();
  await broadcastStatus();
});
chrome.runtime.onStartup.addListener(async () => {
  configure();
  await reschedule();
  await broadcastStatus();
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.tabs.onActivated.addListener(() => broadcastStatus());
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!Number.isInteger(tab.id) || !Number.isInteger(tab.openerTabId) || await isPaused()) return;
  const opener = await chrome.tabs.get(tab.openerTabId).catch(() => null);
  const site = opener && await siteForTab(opener);
  if (!site) return;
  await chrome.storage.session.set({ [inheritedKey(tab.id)]: site });
  await lastActivity(tab.id);
  await scheduleTab(tab.id, await lastActivity(tab.id), site);
});
chrome.tabs.onUpdated.addListener(async (id, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  await lastActivity(id);
  await scheduleTab(id, await lastActivity(id), await siteForTab(await chrome.tabs.get(id).catch(() => null))); 
  await broadcastStatus();
});
chrome.tabs.onRemoved.addListener(async (id) => {
  await chrome.storage.session.remove([activityKey(id), inheritedKey(id)]);
  await clearTabAlarms(id);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.sites || changes.patterns || changes[PAUSE_KEY])) {
    reschedule();
    broadcastStatus();
  }
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === PAUSE_ALARM) {
    await resumeInternal();
    return;
  }
  if (alarm.name === CHECK_ALARM) {
    await reschedule();
    await broadcastStatus();
    return;
  }
  if (alarm.name.startsWith(WARNING_PREFIX)) {
    await broadcastStatus();
    return;
  }
  if (alarm.name.startsWith(CLOSE_PREFIX)) {
    const id = Number(alarm.name.slice(CLOSE_PREFIX.length));
    if (Number.isInteger(id)) await closeIfDue(id);
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "edgeclose-activity" && Number.isInteger(sender.tab?.id)) {
    lastActivity(sender.tab.id).then(() => siteForTab(sender.tab).then((site) => site ? scheduleTab(sender.tab.id, Date.now(), site) : null));
    return;
  }
  if (message.type === "edgeclose-deadline" && Number.isInteger(sender.tab?.id)) {
    closeIfDue(sender.tab.id);
    return;
  }
  if (message.type === "edgeclose-pause") {
    setPause(message.minutes, message.password).then((until) => sendResponse({ ok: until > 0, pauseUntil: until })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "edgeclose-resume") {
    resume(message.password).then((ok) => sendResponse({ ok })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "edgeclose-admin-state") {
    adminState().then(sendResponse).catch(() => sendResponse(null));
    return true;
  }
  if (message.type === "edgeclose-audit-log") {
    chrome.storage.local.get(AUDIT_KEY).then((stored) => sendResponse(Array.isArray(stored[AUDIT_KEY]) ? stored[AUDIT_KEY].slice(0, MAX_AUDIT) : [])).catch(() => sendResponse([]));
    return true;
  }
  if (message.type === "edgeclose-audit") {
    writeAudit(message.event, message.metadata || {}).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
});
